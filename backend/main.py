import shutil
import os
import re
from typing import List, Optional, Dict
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import docx
from docx.document import Document as _Document
import pypdf

app = FastAPI(title="Sirius RPD Analyzer V3")

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
    name: str = "Не определено"
    period: str = "Не найден"
    volume: str = "Не найден"
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

def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip() if text else ""

# --- DOCX Logic (С сохранением рабочей логики для таблиц) ---

def parse_docx_robust(file_path: str) -> DisciplineData:
    doc = docx.Document(file_path)
    data = DisciplineData()
    
    # 1. Текстовый анализ (Цели, ПО, Название)
    full_text = "\n".join([p.text for p in doc.paragraphs])
    
    nm = re.search(r"ДИСЦИПЛИНЫ\s*«([^»]+)»", full_text, re.I)
    if nm: data.name = nm.group(1)
    
    soft = re.search(r"Перечень программного.*?\n(.*?)(6\.|Особенности)", full_text, re.DOTALL | re.I)
    if soft:
        for line in soft.group(1).split('\n'):
            line = clean(line)
            if len(line) > 3 and not "http" in line and not "Не требуется" in line:
                data.software.append(re.sub(r"^\d+\.\s*", "", line))

    # 2. Табличный анализ (Разделы, Часы, Паспорт)
    for table in doc.tables:
        rows_text = [" ".join([c.text.lower() for c in r.cells]) for r in table.rows]
        header = " ".join(rows_text[:5])
        
        # Паспорт
        if "объем" in header:
            for row in table.rows:
                rt = " ".join([c.text.lower() for c in row.cells])
                if "объем" in rt: data.volume = clean(row.cells[-1].text)
                if "период" in rt: data.period = clean(row.cells[-1].text)

        # Разделы (Ищем таблицу с "Раздел" и цифрами)
        if "раздел" in header and len(table.columns) >= 3:
            # Пытаемся найти колонки
            lec_idx = -1
            for i, cell in enumerate(table.rows[0].cells): # Или row[1]
                if "л" in cell.text.lower() or "лек" in cell.text.lower(): lec_idx = i
            
            # Если не нашли в первой строке, ищем во второй
            if lec_idx == -1 and len(table.rows) > 1:
                 for i, cell in enumerate(table.rows[1].cells):
                    if cell.text.lower().strip() == "л": lec_idx = i

            start_row = 1
            if lec_idx != -1: start_row = 2

            for row in table.rows[start_row:]:
                cells = row.cells
                if len(cells) < 3: continue
                # Пропускаем "Итого"
                if "итого" in cells[0].text.lower(): continue

                name = clean(cells[0].text)
                if len(name) > 3 and ("Раздел" in name or "Тема" in name or name[0].isupper()):
                    h = HoursDetail()
                    # Если нашли индекс лекций, берем оттуда, иначе эвристика (3-я колонка)
                    idx = lec_idx if lec_idx != -1 else 2 
                    if idx < len(cells): h.lectures = clean(cells[idx].text)
                    if idx+1 < len(cells): h.practice = clean(cells[idx+1].text)
                    
                    # Контент (обычно 2-я колонка)
                    content = clean(cells[1].text) if len(cells) > 1 else ""
                    
                    data.sections.append(SectionDetail(name=name, content=content, hours=h))

        # PO
        if "результат" in header and "код" in header:
            for row in table.rows[1:]:
                txt = clean(row.cells[0].text) # Код обычно первый
                if re.match(r"^(PO|УК|ПК)", txt):
                    data.outcomes.append(txt)

    return data

# --- PDF Logic (Regex Based) ---

def parse_pdf_regex(file_path: str) -> DisciplineData:
    data = DisciplineData()
    text = ""
    try:
        reader = pypdf.PdfReader(file_path)
        for page in reader.pages:
            text += page.extract_text() + "\n"
    except Exception as e:
        data.goals = f"Ошибка чтения PDF: {e}"
        return data

    # 1. Название
    nm = re.search(r"ДИСЦИПЛИНЫ\s*\n\s*«([^»]+)»", text, re.I)
    if nm: data.name = clean(nm.group(1))

    # 2. Объем (ищем "X з.е.")
    vol = re.search(r"(\d+\s*з\.е\.)", text)
    if vol: data.volume = vol.group(1)

    # 3. Разделы (Самое сложное в PDF)
    # Ищем паттерн: "Раздел X. Название ... цифра цифра"
    # Это ненадежно, но лучше чем ничего.
    # Ищем строки, начинающиеся с "Раздел"
    
    section_pattern = re.compile(r"(Раздел \d+\..*?)\n", re.IGNORECASE)
    matches = section_pattern.findall(text)
    
    for m in matches:
        # Пытаемся найти часы в этой же строке или следующей (в PDF таблицы превращаются в текст с пробелами)
        # Пример: "Раздел 1. Введение 2 2 0 0"
        line = clean(m)
        
        # Ищем цифры в конце строки (часы)
        hours_match = re.findall(r"\s(\d{1,2})\s", line)
        h = HoursDetail()
        if len(hours_match) >= 1: h.lectures = hours_match[0]
        if len(hours_match) >= 2: h.practice = hours_match[1]
        
        data.sections.append(SectionDetail(
            name=line.split("  ")[0], # Берем текст до больших пробелов
            content="Содержание в PDF сложно структурировать",
            hours=h
        ))

    # 4. ПО
    soft = re.search(r"Перечень программного.*?\n(.*?)(6\.|Особенности)", text, re.DOTALL | re.I)
    if soft:
        lines = soft.group(1).split('\n')
        for l in lines:
            if re.match(r"^\d+\.", l.strip()):
                data.software.append(clean(re.sub(r"^\d+\.", "", l)))

    # 5. PO
    outcomes = re.findall(r"(PO\s?\d+|УК-\d+)", text)
    data.outcomes = list(set(outcomes)) # Уник

    return data


# --- Graph ---

def build_graph(data: DisciplineData) -> tuple[List[GraphNode], List[GraphEdge]]:
    nodes = []
    edges = []
    root = "root"
    
    nodes.append(GraphNode(id=root, label=data.name[:50], type="discipline", data={"vol": data.volume}))

    for i, s in enumerate(data.sections):
        sid = f"sec_{i}"
        lbl = s.name[:20] + "..." if len(s.name) > 20 else s.name
        nodes.append(GraphNode(id=sid, label=lbl, type="section", data={"h": s.hours, "content": s.content}))
        edges.append(GraphEdge(source=root, target=sid, label="сод."))

    for i, sw in enumerate(data.software):
        swid = f"sw_{i}"
        nodes.append(GraphNode(id=swid, label=sw[:15], type="tool", data={"full": sw}))
        edges.append(GraphEdge(source=root, target=swid, label="ПО"))
    
    for i, o in enumerate(data.outcomes):
        oid = f"out_{i}"
        nodes.append(GraphNode(id=oid, label=o, type="outcome", data={"full": o}))
        edges.append(GraphEdge(source=root, target=oid, label="PO"))

    return nodes, edges

@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(file: UploadFile = File(...)):
    path = f"temp_{file.filename}"
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    ext = os.path.splitext(file.filename)[1].lower()
    
    if ext == ".docx":
        data = parse_docx_robust(path)
    elif ext == ".pdf":
        data = parse_pdf_regex(path)
    else:
        os.remove(path)
        raise HTTPException(400, "Unsupported")
        
    os.remove(path)
    nodes, edges = build_graph(data)
    return AnalysisResponse(metadata=data, graph_nodes=nodes, graph_edges=edges)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)