import shutil
import os
import re
import tempfile
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import docx
import pypdf

app = FastAPI(title="Sirius RPD Final Fix")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Модели ---
class HoursDetail(BaseModel):
    lectures: str = "-"
    practice: str = "-"
    labs: str = "-"
    self_study: str = "-"

class SectionDetail(BaseModel):
    name: str
    content: str
    hours: HoursDetail

class LiteratureList(BaseModel):
    main: List[str]
    additional: List[str]

class DisciplineData(BaseModel):
    name: str = "Без названия"
    period: str = "-"
    volume: str = "-"
    goals: str = ""
    sections: List[SectionDetail] = []
    outcomes: List[str] = []
    software: List[str] = []
    literature: LiteratureList = LiteratureList(main=[], additional=[])

class GraphNode(BaseModel):
    id: str
    label: str
    type: str 
    data: Dict = {}

class GraphEdge(BaseModel):
    source: str
    target: str
    label: Optional[str] = None

class AnalysisResponse(BaseModel):
    metadata: DisciplineData
    graph_nodes: List[GraphNode]
    graph_edges: List[GraphEdge]

# --- Утилиты ---

def clean(text: str) -> str:
    """
    Агрессивная очистка: заменяет любые переносы строк и табуляции на один пробел.
    Это критично для склеивания разорванных заголовков.
    """
    if not text: return ""
    # Заменяем \xa0 (неразрывный пробел) и \n на обычный пробел
    text = text.replace('\xa0', ' ').replace('\n', ' ')
    # Схлопываем множественные пробелы в один
    return re.sub(r'\s+', ' ', text).strip()

def split_section_name_content(raw_text: str) -> tuple[str, str]:
    """
    Разделяет текст на Заголовок и Содержание.
    Приоритет: Заголовок — это первое полноценное предложение.
    """
    txt = clean(raw_text)
    
    # 1. Если текст пустой
    if not txt: return "", ""

    # 2. Ищем префикс (Раздел Х / Тема Х)
    prefix = ""
    match_prefix = re.match(r"^(Раздел \d+\.?|Тема \d+\.?)\s*", txt)
    if match_prefix:
        prefix = match_prefix.group(0)
        # Работаем с текстом ПОСЛЕ префикса
        body = txt[len(prefix):].strip()
    else:
        body = txt

    # 3. Ищем границу предложения.
    # Граница — это точка (.), за которой следует пробел и Заглавная буква (или конец строки).
    # Регулярка: (\.)(\s+)([А-ЯA-Z])
    
    split_match = re.search(r"(\.)(\s+)([А-ЯA-Z])", body)
    
    if split_match:
        # Нашли точку, разделяющую предложения
        dot_idx = split_match.start()
        # Заголовок = Префикс + Текст до точки включительно
        title_part = body[:dot_idx+1] 
        # Контент = Всё что после
        content_part = body[dot_idx+1:].strip()
        
        full_title = (prefix + " " + title_part).strip()
        # Убираем двойные точки если есть
        full_title = full_title.replace("..", ".")
        
        return full_title, content_part

    # 4. Если явного разделения предложения нет (нет точки в середине)
    # Если текст не гигантский (например, < 250 символов), считаем ВЕСЬ текст заголовком.
    # Это исправляет ошибку, когда заголовок длинный, но без точки в конце.
    if len(txt) < 300:
        return txt, ""

    # 5. Фолбэк: Если текст огромный и без точек, отрезаем первые 100 символов как заголовок
    return txt[:100] + "...", txt[100:]

# --- DOCX Парсер ---
def parse_docx_structural(file_path: str) -> DisciplineData:
    doc = docx.Document(file_path)
    data = DisciplineData()
    full_text_blob = "\n".join([p.text for p in doc.paragraphs])

    # 1. Название
    for p in doc.paragraphs[:20]:
        t = clean(p.text)
        if "«" in t and "»" in t and len(t) < 200:
            if "УНИВЕРСИТЕТ" not in t.upper() and "СОГЛАСОВАНА" not in t.upper():
                data.name = t.strip('«»"\n')
                break

    # 2. Цели
    goals_match = re.search(r"(1\.3|Цели)\.?\s*Цели.*?\n(.*?)(2\.|Содержание)", full_text_blob, re.DOTALL | re.I)
    if goals_match:
        data.goals = clean(goals_match.group(2))
    else:
        goals_acc = []
        in_goals = False
        for p in doc.paragraphs:
            t = clean(p.text)
            if re.match(r"^1\.3|^Цели дисциплины", t, re.I):
                in_goals = True
                continue
            if in_goals:
                if re.match(r"^2\.|^Содержание", t, re.I): break
                goals_acc.append(t)
        if goals_acc: data.goals = " ".join(goals_acc)

    # 3. Списки
    state = None
    for p in doc.paragraphs:
        t = clean(p.text)
        if re.match(r"^4\.1", t): state = 'lit_main'
        elif re.match(r"^4\.2", t): state = 'lit_add'
        elif re.match(r"^5\.2", t): state = 'soft'
        elif re.match(r"^(6\.|5\.3|3\.|2\.)", t): state = None
        else:
            if state == 'soft' and (re.match(r"^(\d+\.|-|•)", t) or len(t)>3):
                if "Перечень" not in t: data.software.append(re.sub(r"^\d+\.\s*", "", t))
            elif state == 'lit_main' and re.match(r"^\d+\.", t):
                data.literature.main.append(t)
            elif state == 'lit_add' and re.match(r"^\d+\.", t):
                data.literature.additional.append(t)

    # 4. ТАБЛИЦЫ
    for table in doc.tables:
        if len(table.rows) < 2: continue
        
        hours_indices = []
        # Ищем колонки с цифрами
        for r in table.rows[1:8]:
            for i, cell in enumerate(r.cells):
                txt = cell.text.strip()
                if txt.isdigit() and len(txt) <= 3:
                    if i not in hours_indices: hours_indices.append(i)
        
        hours_indices.sort()
        
        if len(hours_indices) >= 2: 
            for row in table.rows:
                cells = row.cells
                if not cells: continue
                
                c0 = clean(cells[0].text)
                
                if "итого" in c0.lower() or "раздел" in c0.lower() or "семестр" in c0.lower(): continue
                if len(c0) < 2: continue

                final_name = ""
                final_content = ""

                # Логика определения колонок
                first_hour_col = hours_indices[0]
                
                # Если до первой цифры есть 2+ колонки (0 и 1), значит: 0=Название/Номер, 1=Содержание/Название
                if first_hour_col >= 2 and len(cells) > 1:
                    c1 = clean(cells[1].text)
                    if c1:
                        # Если c0 очень короткое (просто номер "1."), а c1 длинное -> c1 это название
                        if len(c0) < 6 and len(c1) > 5:
                            n, c = split_section_name_content(c1)
                            final_name = f"Тема {c0} {n}"
                            final_content = c
                        else:
                            # Иначе считаем c0 названием, c1 контентом
                            final_name = c0
                            final_content = c1
                    else:
                        # c1 пустая, берем всё из c0
                        final_name, final_content = split_section_name_content(c0)
                else:
                    # Мало колонок, всё в c0
                    final_name, final_content = split_section_name_content(c0)

                # Доп. проверка: если имя получилось слишком коротким ("Основные"), а контент начинается с маленькой буквы
                # значит мы ошибочно разделили.
                if len(final_name.split()) < 3 and len(final_name) < 30 and final_content and final_content[0].islower():
                     final_name = f"{final_name} {final_content}"
                     final_content = ""

                # Часы
                h = HoursDetail()
                try:
                    vals = []
                    for idx in hours_indices:
                        if idx < len(cells):
                            v = clean(cells[idx].text)
                            vals.append(v if v.isdigit() else "0")
                    
                    if len(vals) >= 1: h.lectures = vals[0]
                    if len(vals) >= 2: h.practice = vals[1]
                    if len(vals) == 3: h.self_study = vals[2]
                    elif len(vals) >= 4:
                         h.labs = vals[2]
                         h.self_study = vals[3]
                except: pass

                data.sections.append(SectionDetail(name=final_name, content=final_content, hours=h))

    return data

# --- PDF Fallback ---
def parse_pdf_regex(file_path: str) -> DisciplineData:
    data = DisciplineData()
    text = ""
    try:
        reader = pypdf.PdfReader(file_path)
        for page in reader.pages: text += page.extract_text() + "\n"
    except: return data

    m = re.search(r"ДИСЦИПЛИНЫ\s*«([^»]+)»", clean(text), re.I)
    if m: data.name = m.group(1)
    
    vol = re.search(r"(\d+\s*з\.е\.)", text)
    if vol: data.volume = clean(vol.group(1))
    
    goals = re.search(r"Цели дисциплины.*?\n(.*?)(2\.|Содержание)", text, re.DOTALL | re.I)
    if goals: data.goals = clean(goals.group(1))

    # Разделы (PDF) - Улучшенный regex
    chunks = re.split(r"(Раздел \d+\.)", text)
    for i in range(1, len(chunks), 2):
        header = chunks[i] 
        body = chunks[i+1]
        
        hours_m = re.search(r"(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})", body)
        h = HoursDetail()
        
        content = body
        if hours_m:
            nums = hours_m.groups()
            h.lectures, h.practice, h.labs, h.self_study = nums
            content = body.replace(hours_m.group(0), "")
        
        # Используем ту же функцию clean и split для PDF
        name, desc = split_section_name_content(content)
        
        full_name = f"{header} {name}"
        data.sections.append(SectionDetail(name=full_name, content=desc[:500], hours=h))

    soft = re.search(r"Перечень программного.*?\n(.*?)(6\.|Особенности)", text, re.DOTALL | re.I)
    if soft:
        for l in soft.group(1).split('\n'):
            if re.match(r"^\d+\.", l.strip()):
                data.software.append(clean(re.sub(r"^\d+\.", "", l)))
    return data

# --- Graph ---
def build_graph(data: DisciplineData) -> tuple[List[GraphNode], List[GraphEdge]]:
    nodes = []
    edges = []
    root = "root"
    
    nodes.append(GraphNode(id=root, label=data.name[:60], type="discipline", data=data.dict()))

    for i, s in enumerate(data.sections):
        sid = f"s_{i}"
        lbl = s.name.replace("Раздел", "").strip()
        lbl = re.sub(r"^\d+\.\s*", "", lbl) # Убираем номер
        if len(lbl) > 25: lbl = lbl[:25] + "..."
        if len(lbl) < 2: lbl = f"Раздел {i+1}"
        
        nodes.append(GraphNode(id=sid, label=lbl, type="section", data={"full_name": s.name, "content": s.content, "hours": s.hours}))
        edges.append(GraphEdge(source=root, target=sid))

    for i, sw in enumerate(data.software):
        swid = f"sw_{i}"
        lbl = sw.split(",")[0][:20]
        nodes.append(GraphNode(id=swid, label=lbl, type="tool", data={"full_name": sw}))
        edges.append(GraphEdge(source=root, target=swid))

    for i, o in enumerate(data.outcomes):
        oid = f"o_{i}"
        nodes.append(GraphNode(id=oid, label=o.split()[0], type="outcome", data={"full_name": o}))
        edges.append(GraphEdge(source=root, target=oid))

    return nodes, edges

@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(file: UploadFile = File(...)):
    # Используем tempfile для надежности
    ext = os.path.splitext(file.filename)[1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        if ext == ".docx": data = parse_docx_structural(tmp_path)
        elif ext == ".pdf": data = parse_pdf_regex(tmp_path)
        else: 
            raise HTTPException(400, "Only PDF/DOCX")
    except Exception as e:
        print(e)
        raise HTTPException(500, "Parsing Error")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        
    nodes, edges = build_graph(data)
    return AnalysisResponse(metadata=data, graph_nodes=nodes, graph_edges=edges)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)