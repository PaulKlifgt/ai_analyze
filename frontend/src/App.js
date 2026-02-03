import React, { useState, useCallback } from 'react';
import ReactFlow, { 
  Controls, 
  Background, 
  applyEdgeChanges, 
  applyNodeChanges, 
  MiniMap 
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';

// UI Компоненты
const Card = ({ title, children, className }) => (
  <div className={`bg-white p-4 rounded shadow mb-4 border border-gray-200 ${className}`}>
    <h3 className="font-bold text-lg mb-2 border-b pb-1 text-blue-800">{title}</h3>
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
  
  const onNodeClick = (event, node) => {
    setSelectedNode(node);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setMetadata(null);
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post('http://localhost:8000/api/analyze', formData);
      const data = res.data;

      setMetadata(data.metadata);

      const layoutNodes = data.graph_nodes.map((node, i) => {
        let pos = { x: 0, y: 0 };
        const style = { width: 150, fontSize: '12px', textAlign: 'center' };

        if (node.type === 'discipline') {
          pos = { x: 400, y: 50 };
          style.background = '#dbeafe'; 
          style.width = 250;
          style.fontWeight = 'bold';
          style.fontSize = '14px';
        } else if (node.type === 'outcome') {
          pos = { x: 100, y: 150 + i * 120 };
          style.background = '#fef3c7';
        } else if (node.type === 'tool') {
          pos = { x: 750, y: 150 + i * 80 };
          style.background = '#d1fae5';
        } else if (node.type === 'section') {
          const col = i % 3;
          const row = Math.floor(i / 3);
          pos = { x: 250 + col * 200, y: 500 + row * 150 };
          style.background = '#f3f4f6';
          style.width = 180;
        }

        return {
          id: node.id,
          type: 'default',
          data: { label: node.label, ...node.data },
          position: pos,
          style: { ...style, border: '1px solid #777', borderRadius: '8px', padding: '10px' }
        };
      });

      const layoutEdges = data.graph_edges.map((edge, i) => ({
        id: `e-${i}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
        style: { stroke: '#b1b1b7' }
      }));

      setNodes(layoutNodes);
      setEdges(layoutEdges);

    } catch (err) {
      console.error(err);
      alert("Ошибка обработки файла. Проверьте консоль Python.");
    } finally {
      setLoading(false);
    }
  };

  // Функция для безопасного отображения данных узла (чтобы не падал React)
  const renderValue = (key, value) => {
    if (key === 'label') return null;
    
    // Если это объект (например, часы), рендерим красиво
    if (typeof value === 'object' && value !== null) {
      return (
        <div key={key} className="mb-2">
          <span className="font-semibold text-gray-600 block">{key}:</span>
          <div className="pl-2 text-xs bg-white rounded border border-gray-200">
            {Object.entries(value).map(([k, v]) => (
              <div key={k} className="flex justify-between px-1">
                <span>{k}:</span> <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    // Обычный текст
    return (
      <div key={key} className="mb-1 break-words">
        <span className="font-semibold text-gray-600">{key}:</span> {value}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      <header className="bg-slate-800 text-white p-4 shadow-md flex justify-between items-center z-10">
        <h1 className="text-xl font-bold">🎓 ИИ-Анализатор РПД</h1>
        <div className="flex items-center gap-4">
           {loading && <span className="text-yellow-300 animate-pulse font-bold">Анализ...</span>}
           <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded transition">
             Загрузить файл
             <input type="file" onChange={handleFileUpload} className="hidden" accept=".doc,.docx,.pdf" />
           </label>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 border-r border-gray-300 relative bg-white">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
          >
            <Background color="#ccc" gap={20} />
            <Controls />
            <MiniMap style={{height: 100}} />
          </ReactFlow>
          <div className="absolute top-4 left-4 bg-white/90 p-2 text-xs rounded shadow text-gray-600">
            Кликните на узел для деталей
          </div>
        </div>

        <div className="w-96 p-4 overflow-y-auto bg-gray-50 shadow-inner">
          {!metadata ? (
            <div className="text-gray-400 text-center mt-20">Загрузите файл для начала работы</div>
          ) : (
            <>
              {selectedNode ? (
                 <Card title="Информация об узле">
                    <div className="font-bold text-lg mb-2">{selectedNode.data.label}</div>
                    <div className="bg-gray-100 p-2 rounded text-xs overflow-auto max-h-[60vh]">
                      {Object.entries(selectedNode.data).map(([key, val]) => renderValue(key, val))}
                    </div>
                    <button onClick={() => setSelectedNode(null)} className="mt-4 w-full py-1 bg-blue-100 hover:bg-blue-200 rounded text-sm text-blue-800 transition">
                      Закрыть
                    </button>
                 </Card>
              ) : (
                <>
                  <Card title="📘 Паспорт">
                    <p><strong>Название:</strong> {metadata.name}</p>
                    <p><strong>Объем:</strong> {metadata.volume}</p>
                  </Card>
                  
                  <Card title="💻 ПО">
                    <ul className="list-disc pl-4 text-xs">
                        {metadata.software.map((s,i) => <li key={i}>{s}</li>)}
                    </ul>
                  </Card>

                  <Card title="📚 Разделы">
                     {metadata.sections.map((sec, i) => (
                       <div key={i} className="mb-2 pl-2 border-l-2 border-slate-400">
                         <div className="font-bold text-xs">{sec.name}</div>
                         <div className="text-[10px] text-gray-500">Лек: {sec.hours.lectures} | Прак: {sec.hours.practice}</div>
                       </div>
                     ))}
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;