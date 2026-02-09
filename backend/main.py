import shutil
import os
import re
from typing import List, Optional, Dict
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
    if not text: return ""
    return re.sub(r'\s+', ' ', text).strip()

def split_section_name_content(raw_text: str) -> tuple[str, str]:
    """
    Разделяет 'Раздел 1. Введение. Тут идет описание...' на Заголовок и Описание.
    """
    txt = clean(raw_text)
    
    # 1. Поиск первой точки после 10-го символа (чтобы не отрезать "Раздел 1.")
    # Обычно заголовок короткий (до 100 символов), а описание длинное
    dot_idx = txt.find('.', 8)
    
    if dot_idx != -1 and dot_idx < 100:
        # Проверяем, что после точки идет пробел и Большая буква (начало предложения)
        if dot_idx + 2 < len(txt) and txt[dot_idx+1] == ' ':
             name = txt[:dot_idx+1]
             content = txt[dot_idx+1:].strip()
             return name, content
    
    return txt, "" # Не удалось разделить

# --- DOCX Парсер ---
def parse_docx_structural(file_path: str) -> DisciplineData:
    doc = docx.Document(file_path)
    data = DisciplineData()
    full_text_blob = "\n".join([p.text for p in doc.paragraphs])

    # 1. Название
    for p in doc.paragraphs[:20]:
        t = clean(p.text)
        if "«" in t and "»" in t and len(t) < 150:
            if "УНИВЕРСИТЕТ" not in t.upper() and "СОГЛАСОВАНА" not in t.upper():
                data.name = t.strip('«»"\n')
                break

    # 2. Цели (Гибридный поиск)
    # Сначала пробуем Regex по всему тексту (надежнее)
    goals_match = re.search(r"(1\.3|Цели)\.?\s*Цели.*?\n(.*?)(2\.|Содержание)", full_text_blob, re.DOTALL | re.I)
    if goals_match:
        data.goals = clean(goals_match.group(2))
    else:
        # Если не вышло, пробуем параграфы
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

    # 4. ТАБЛИЦЫ (Поиск данных, а не заголовков)
    for table in doc.tables:
        if len(table.rows) < 2: continue
        
        # Склеиваем шапку для идентификации
        header_raw = " ".join([c.text.lower() for row in table.rows[:5] for c in row.cells])
        
        # А) ПАСПОРТ
        if "объем" in header_raw or "паспорт" in header_raw:
            for row in table.rows:
                rt = " ".join([c.text.lower() for c in row.cells])
                if "период" in rt: 
                    for c in reversed(row.cells): 
                        if c.text.strip(): data.period = clean(c.text); break
                if "объем" in rt: 
                    for c in reversed(row.cells):
                        if c.text.strip(): data.volume = clean(c.text); break

        # Б) PO
        if "результат" in header_raw:
            for row in table.rows:
                for cell in row.cells:
                    txt = clean(cell.text)
                    if re.match(r"^(PO|УК|ОПК|ПК)[- ]?\d+", txt, re.I):
                        if txt not in data.outcomes: data.outcomes.append(txt)

        # В) РАЗДЕЛЫ (Детектор структуры данных)
        # Мы считаем таблицу "таблицей разделов", если:
        # 1. Колонок >= 4
        # 2. В колонках 2, 3 или 4 есть цифры в большинстве строк
        
        if len(table.columns) >= 4:
            # Проверка на цифры
            digit_col_found = False
            hours_indices = []
            
            # Сканируем строки данных (со 2-й по 10-ю)
            for r in table.rows[1:10]:
                for i in range(2, len(r.cells)):
                    if r.cells[i].text.strip().isdigit():
                        if i not in hours_indices: hours_indices.append(i)
            
            hours_indices.sort()
            
            # Если нашли колонки с цифрами - это наша таблица!
            if len(hours_indices) >= 2: # Хотя бы Лекции и Практика
                
                # Парсим
                for row in table.rows:
                    cells = row.cells
                    c0 = clean(cells[0].text)
                    
                    # Фильтр мусора
                    if "итого" in c0.lower() or "раздел" in c0.lower() or "промежуточная" in c0.lower(): continue
                    
                    # Пытаемся взять Имя и Контент
                    # Вариант 1: Имя в Col 0, Контент в Col 1
                    name_cand = c0
                    content_cand = clean(cells[1].text) if len(cells) > 1 else ""
                    
                    final_name = name_cand
                    final_content = content_cand

                    # Вариант 2: Если Col 1 пустая, возможно всё в Col 0 (нужно разделить)
                    if not content_cand and len(name_cand) > 10:
                        n, c = split_section_name_content(name_cand)
                        final_name = n
                        final_content = c
                    
                    if len(final_name) < 2 and len(final_content) < 5: continue

                    # Часы
                    h = HoursDetail()
                    try:
                        if len(hours_indices) >= 1: h.lectures = clean(cells[hours_indices[0]].text)
                        if len(hours_indices) >= 2: h.practice = clean(cells[hours_indices[1]].text)
                        if len(hours_indices) >= 3: h.labs = clean(cells[hours_indices[2]].text)
                        # СР обычно последняя
                        h.self_study = clean(cells[hours_indices[-1]].text)
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

    m = re.search(r"ДИСЦИПЛИНЫ\s*«([^»]+)»", text, re.I)
    if m: data.name = clean(m.group(1))
    
    vol = re.search(r"(\d+\s*з\.е\.)", text)
    if vol: data.volume = clean(vol.group(1))
    
    goals = re.search(r"Цели дисциплины.*?\n(.*?)(2\.|Содержание)", text, re.DOTALL | re.I)
    if goals: data.goals = clean(goals.group(1))

    # Разделы (PDF)
    # Разбиваем по ключевому слову "Раздел"
    chunks = re.split(r"(Раздел \d+\.)", text)
    for i in range(1, len(chunks), 2):
        header = chunks[i] # Раздел 1.
        body = chunks[i+1] # Текст...
        
        # Ищем часы в body (группа цифр)
        hours_m = re.search(r"(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})", body)
        h = HoursDetail()
        
        content = body
        if hours_m:
            nums = hours_m.groups()
            h.lectures, h.practice, h.labs, h.self_study = nums
            # Удаляем строку с цифрами из контента
            content = body.replace(hours_m.group(0), "")
        
        # Пытаемся вытащить название (первая строка)
        lines = content.strip().split('\n')
        name_part = lines[0] if lines else "Тема"
        content_part = "\n".join(lines[1:]) if len(lines) > 1 else ""
        
        full_name = f"{header} {name_part}"
        data.sections.append(SectionDetail(name=full_name, content=content_part[:500], hours=h))

    # ПО
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
    path = f"temp_{file.filename}"
    with open(path, "wb") as f: shutil.copyfileobj(file.file, f)
    
    ext = os.path.splitext(file.filename)[1].lower()
    if ext == ".docx": data = parse_docx_structural(path)
    elif ext == ".pdf": data = parse_pdf_regex(path)
    else: 
        os.remove(path)
        raise HTTPException(400, "Only PDF/DOCX")
        
    os.remove(path)
    nodes, edges = build_graph(data)
    return AnalysisResponse(metadata=data, graph_nodes=nodes, graph_edges=edges)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)