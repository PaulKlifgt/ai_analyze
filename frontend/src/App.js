import React, { useState, useCallback } from 'react';
import ReactFlow, { Controls, Background, applyEdgeChanges, applyNodeChanges, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';

const Card = ({ title, children }) => (
  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-4">
    <h3 className="font-bold text-blue-900 border-b pb-2 mb-3 text-sm uppercase tracking-wide">{title}</h3>
    <div className="text-sm text-gray-700">{children}</div>
  </div>
);

const App = () => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(false);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onNodeClick = (e, node) => setSelectedNode(node);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post('http://localhost:8000/api/analyze', formData);
      const { metadata, graph_nodes, graph_edges } = res.data;
      setMetadata(metadata);
      
      const layoutNodes = graph_nodes.map((n, i) => {
        let x=0, y=0, bg='#fff', w=180;
        if (n.type === 'discipline') { x=400; y=0; bg='#dbeafe'; w=300; }
        else if (n.type === 'outcome') { x=50; y=100+i*120; bg='#fef3c7'; }
        else if (n.type === 'tool') { x=850; y=100+i*80; bg='#dcfce7'; }
        else if (n.type === 'section') { 
            const row = Math.floor(i/3); const col = i%3;
            x = 300 + col*250; y = 500 + row*200; bg='#f3f4f6'; w=220;
        }
        return { 
            id: n.id, position: {x,y}, data: {label: n.label, ...n.data}, 
            style: {background: bg, border:'1px solid #999', borderRadius:8, padding:10, width:w, fontSize:12, textAlign:'center'} 
        };
      });
      setNodes(layoutNodes);
      setEdges(graph_edges.map((e,i)=>({...e, id:`e${i}`, animated:true, style:{stroke:'#ccc'}})));
    } catch (e) { console.error(e); alert("Ошибка при обработке"); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      <div className="flex-1 relative border-r">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={onNodeClick} fitView>
          <Background gap={20} color="#e5e7eb" />
          <Controls />
          <MiniMap style={{height: 100}} />
        </ReactFlow>
        <div className="absolute top-4 left-4 z-10">
            <label className="bg-blue-600 text-white px-4 py-2 rounded cursor-pointer shadow hover:bg-blue-700 transition font-medium">
                {loading ? "Анализ..." : "Загрузить РПД"}
                <input type="file" onChange={handleFile} className="hidden" accept=".docx,.pdf" />
            </label>
        </div>
      </div>

      <div className="w-1/3 min-w-[400px] p-4 overflow-y-auto bg-white shadow-xl z-20">
        {!metadata ? <div className="text-center mt-20 text-gray-400">Выберите файл</div> : (
            selectedNode ? (
                <Card title="Детали элемента">
                    <div className="font-bold mb-3 text-lg leading-snug">{selectedNode.data.full_name || selectedNode.data.label}</div>
                    
                    {selectedNode.data.hours && (
                        <div className="mb-4">
                            <div className="text-[10px] uppercase text-gray-500 font-bold mb-1">Нагрузка</div>
                            <div className="grid grid-cols-4 gap-2 text-center text-xs">
                                <div className="bg-blue-50 p-2 border border-blue-100 rounded">
                                    <div className="font-bold text-blue-700 text-lg">{selectedNode.data.hours.lectures}</div>
                                    Лекции
                                </div>
                                <div className="bg-green-50 p-2 border border-green-100 rounded">
                                    <div className="font-bold text-green-700 text-lg">{selectedNode.data.hours.practice}</div>
                                    Практика
                                </div>
                                <div className="bg-purple-50 p-2 border border-purple-100 rounded">
                                    <div className="font-bold text-purple-700 text-lg">{selectedNode.data.hours.labs}</div>
                                    Лаб.
                                </div>
                                <div className="bg-orange-50 p-2 border border-orange-100 rounded">
                                    <div className="font-bold text-orange-700 text-lg">{selectedNode.data.hours.self_study}</div>
                                    Сам.раб
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {selectedNode.data.content && (
                        <div className="mt-3">
                            <div className="text-[10px] uppercase text-gray-500 font-bold mb-1">Содержание</div>
                            <div className="bg-gray-50 p-3 rounded border text-xs leading-relaxed text-gray-700 whitespace-pre-wrap">
                                {selectedNode.data.content}
                            </div>
                        </div>
                    )}
                    
                    <button onClick={()=>setSelectedNode(null)} className="w-full mt-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 text-sm font-medium transition">Закрыть</button>
                </Card>
            ) : (
                <>
                    <Card title="Паспорт дисциплины">
                        <div className="font-bold text-lg mb-2">{metadata.name}</div>
                        <div className="flex gap-2 text-xs">
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded font-mono">Объем: {metadata.volume}</span>
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded font-mono">Период: {metadata.period}</span>
                        </div>
                    </Card>
                    
                    <Card title="Цели освоения">
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{metadata.goals || "Не найдено"}</p>
                    </Card>

                    <Card title="Программное обеспечение">
                        <ul className="list-disc pl-4 text-sm space-y-2">
                            {metadata.software.map((s,i)=><li key={i} className="break-words">{s}</li>)}
                        </ul>
                    </Card>

                    <Card title="Разделы курса">
                        {metadata.sections.map((s,i) => (
                            <div key={i} className="mb-4 border-l-4 border-slate-300 pl-3 py-1 hover:bg-slate-50 transition">
                                <div className="font-bold text-sm text-blue-900 mb-1">{s.name}</div>
                                {s.content && <div className="text-xs text-gray-600 mb-2 line-clamp-3" title={s.content}>{s.content}</div>}
                                <div className="flex gap-3 text-[10px] text-gray-500 font-mono bg-white inline-block px-2 py-1 rounded border">
                                    <span>Лек:{s.hours.lectures}</span>
                                    <span>Пр:{s.hours.practice}</span>
                                    <span>Лаб:{s.hours.labs}</span>
                                </div>
                            </div>
                        ))}
                    </Card>

                    <Card title="Литература">
                        {metadata.literature.main.length > 0 && (
                            <div className="mb-3">
                                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Основная</div>
                                <ul className="list-decimal pl-4 text-xs space-y-1">
                                    {metadata.literature.main.map((l,i)=><li key={i} className="break-words">{l}</li>)}
                                </ul>
                            </div>
                        )}
                        {metadata.literature.additional.length > 0 && (
                            <div>
                                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Дополнительная</div>
                                <ul className="list-decimal pl-4 text-xs space-y-1">
                                    {metadata.literature.additional.map((l,i)=><li key={i}>{l}</li>)}
                                </ul>
                            </div>
                        )}
                    </Card>
                </>
            )
        )}
      </div>
    </div>
  );
};

export default App;