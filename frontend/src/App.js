import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Controls, Background, applyEdgeChanges, applyNodeChanges,
  MiniMap, MarkerType, Panel, Handle, Position,
  useReactFlow, ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';

const API = 'http://localhost:8000';

/* ═══════════════════════════════════════════════════
   Color System
   ═══════════════════════════════════════════════════ */

const CATEGORY_COLORS = {
  technical: {
    primary: '#2563eb', primaryDark: '#1d4ed8', primaryLight: '#dbeafe',
    primaryBorder: '#93c5fd', accent: '#3b82f6', bg: '#eff6ff', ring: '#bfdbfe',
    text: '#1e3a8a', gradient: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    shades: ['#1e40af','#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe','#dbeafe'],
  },
  humanitarian: {
    primary: '#ea580c', primaryDark: '#c2410c', primaryLight: '#ffedd5',
    primaryBorder: '#fdba74', accent: '#f97316', bg: '#fff7ed', ring: '#fed7aa',
    text: '#7c2d12', gradient: 'linear-gradient(135deg, #ea580c, #c2410c)',
    shades: ['#9a3412','#c2410c','#ea580c','#f97316','#fb923c','#fdba74','#ffedd5'],
  },
  natural_science: {
    primary: '#16a34a', primaryDark: '#15803d', primaryLight: '#dcfce7',
    primaryBorder: '#86efac', accent: '#22c55e', bg: '#f0fdf4', ring: '#bbf7d0',
    text: '#14532d', gradient: 'linear-gradient(135deg, #16a34a, #15803d)',
    shades: ['#14532d','#15803d','#16a34a','#22c55e','#4ade80','#86efac','#dcfce7'],
  },
};

const getColors = (cat) => CATEGORY_COLORS[cat] || CATEGORY_COLORS.technical;

const getShadeIndex = (period, totalShades = 7) => {
  if (!period || period === '-') return 3;
  const nums = period.match(/\d+/g);
  if (!nums) return 3;
  const maxSem = Math.max(...nums.map(Number));
  return Math.max(0, Math.min(totalShades - 1, totalShades - 1 - Math.floor((maxSem - 1) / 1.5)));
};

const CATEGORY_LABELS = {
  technical: '🔧 Техническая',
  humanitarian: '📚 Гуманитарная',
  natural_science: '🌿 Естественная',
};

/* ═══ Icons ═══ */
const UploadIcon = () => (
  <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
  </svg>
);
const Spinner = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity=".25"/>
    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" opacity=".75"/>
  </svg>
);
const XIcon = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
  </svg>
);
const FolderIcon = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
  </svg>
);
const TrashIcon = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
  </svg>
);
const SidebarIcon = () => (
  <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
  </svg>
);

/* ═══ Helpers ═══ */
const truncate = (s, n) => (!s ? '' : s.length > n ? s.slice(0, n) + '…' : s);
const getLitText = (l) => {
  if (typeof l === 'string') return l;
  return l?.title?.length > 3 ? l.title : l?.raw || '';
};
const parseH = (v) => {
  if (typeof v === 'string') { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  return v || 0;
};
const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};
const formatDate = (iso) => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
      + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

/* ═══════════════════════════════════════════════════
   Custom Nodes
   ═══════════════════════════════════════════════════ */

const SuperRootNode = ({ data }) => (
  <div className="px-8 py-5 rounded-2xl text-center cursor-grab active:cursor-grabbing select-none"
    style={{ background: '#1f2937', color: '#fff', minWidth: 200,
             boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
    <Handle type="source" position={Position.Bottom}
      className="!bg-gray-400 !w-3 !h-3 !border-0"/>
    <div className="text-lg font-black">Дисциплины</div>
    <div className="text-xs opacity-60 mt-1">{data.count} загружено</div>
  </div>
);

const DirectionNode = ({ data, selected }) => (
  <div className={`px-5 py-3 rounded-xl text-center cursor-grab active:cursor-grabbing select-none
    border-2 ${selected ? 'ring-4 ring-gray-300' : ''}`}
    style={{ background: '#f3f4f6', borderColor: '#9ca3af', minWidth: 180, maxWidth: 260 }}>
    <Handle type="target" position={Position.Top}
      className="!bg-gray-400 !w-2 !h-2 !border-0"/>
    <Handle type="source" position={Position.Bottom}
      className="!bg-gray-400 !w-2 !h-2 !border-0"/>
    <div className="text-xs font-bold text-gray-700">{data.label}</div>
    <div className="text-[10px] text-gray-400 mt-0.5">{data.count} дисц.</div>
  </div>
);

const DisciplineNode = ({ data, selected }) => {
  const cat = data.category || 'technical';
  const colors = getColors(cat);
  const shadeIdx = getShadeIndex(data.period);
  const bgColor = colors.shades[shadeIdx] || colors.primary;
  return (
    <div className={`px-6 py-4 rounded-2xl text-center cursor-grab active:cursor-grabbing
      select-none ${selected ? 'ring-4' : ''}`}
      style={{ background: bgColor, color: '#fff', minWidth: 220, maxWidth: 300,
               boxShadow: `0 8px 28px ${bgColor}44`, ringColor: colors.ring }}>
      <Handle type="target" position={Position.Top} id="target-top"
        className="!w-2 !h-2 !border-0" style={{ background: colors.primaryLight }}/>
      <Handle type="source" position={Position.Bottom} id="bottom"
        className="!w-2 !h-2 !border-0" style={{ background: colors.primaryLight }}/>
      <Handle type="source" position={Position.Right} id="right"
        className="!w-2 !h-2 !border-0" style={{ background: colors.primaryLight }}/>
      <Handle type="source" position={Position.Left} id="left"
        className="!w-2 !h-2 !border-0" style={{ background: colors.primaryLight }}/>
      <Handle type="source" position={Position.Top} id="top"
        className="!w-2 !h-2 !border-0" style={{ background: colors.primaryLight }}/>
      <div className="text-[10px] font-bold opacity-70 mb-1">
        {CATEGORY_LABELS[cat] || '📄'}
      </div>
      <div className="text-sm font-bold leading-snug">{data.label}</div>
      {data.sub && <div className="text-xs opacity-70 mt-1">{data.sub}</div>}
      {data.edu_level && <div className="text-[10px] opacity-60 mt-0.5">{data.edu_level}</div>}
    </div>
  );
};

const SectionNode = ({ data, selected }) => {
  const cat = data.category || 'technical';
  const colors = getColors(cat);
  return (
    <div className={`px-4 py-3 rounded-xl text-center cursor-grab active:cursor-grabbing
      select-none border-2 transition-all
      ${selected ? 'shadow-lg' : 'shadow-sm hover:shadow-md'}`}
      style={{ background: colors.primaryLight,
               borderColor: selected ? colors.primary : colors.primaryBorder,
               minWidth: 150, maxWidth: 220,
               ...(selected ? { boxShadow: `0 0 0 3px ${colors.ring}` } : {}) }}>
      <Handle type="target" position={Position.Bottom}
        className="!w-2 !h-2 !border-0" style={{ background: colors.accent }}/>
      <Handle type="target" position={Position.Top} id="target-top"
        className="!w-2 !h-2 !border-0" style={{ background: colors.accent }}/>
      <Handle type="source" position={Position.Top} id="top"
        className="!w-2 !h-2 !border-0" style={{ background: colors.accent }}/>
      <Handle type="source" position={Position.Right} id="right"
        className="!w-2 !h-2 !border-0" style={{ background: colors.accent }}/>
      <Handle type="source" position={Position.Left} id="left"
        className="!w-2 !h-2 !border-0" style={{ background: colors.accent }}/>
      <div className="text-xs font-bold leading-snug" style={{ color: colors.text }}>
        {data.label}
      </div>
      {data.hours > 0 && (
        <div className="text-[10px] mt-1 font-medium" style={{ color: colors.accent }}>
          {data.hours}ч
        </div>
      )}
      {data.swCount > 0 && (
        <div className="text-[9px] text-emerald-600 mt-0.5">🔧 {data.swCount}</div>
      )}
    </div>
  );
};

const SoftwareNode = ({ data, selected }) => (
  <div className={`px-3 py-2 rounded-lg text-center cursor-grab active:cursor-grabbing
    select-none border-2 transition-all
    ${selected ? 'border-emerald-500 ring-2 ring-emerald-200' :
      'border-emerald-300 hover:shadow-md'}`}
    style={{ background: '#ecfdf5', minWidth: 100, maxWidth: 170 }}>
    <Handle type="target" position={Position.Left}
      className="!bg-emerald-400 !w-2 !h-2 !border-0"/>
    <Handle type="target" position={Position.Bottom} id="bottom"
      className="!bg-emerald-400 !w-2 !h-2 !border-0"/>
    <div className="text-[10px] font-semibold text-emerald-800">{data.label}</div>
    {data.sections?.length > 0 && (
      <div className="text-[8px] text-emerald-500 mt-0.5">{data.sections.length} разд.</div>
    )}
  </div>
);

const LitMainNode = ({ data, selected }) => (
  <div className={`px-3 py-2.5 rounded-xl text-center cursor-grab active:cursor-grabbing
    select-none border-2 transition-all
    ${selected ? 'border-purple-500 ring-2 ring-purple-200' :
      'border-purple-300 hover:shadow-md'}`}
    style={{ background: '#faf5ff', minWidth: 180, maxWidth: 240 }}>
    <Handle type="target" position={Position.Top}
      className="!bg-purple-400 !w-2 !h-2 !border-0"/>
    <div className="text-[11px] font-medium text-purple-800 leading-snug">{data.label}</div>
  </div>
);

const LitAddNode = ({ data, selected }) => (
  <div className={`px-3 py-2.5 rounded-xl text-center cursor-grab active:cursor-grabbing
    select-none border-2 border-dashed transition-all
    ${selected ? 'border-blue-500 ring-2 ring-blue-200' :
      'border-blue-300 hover:shadow-md'}`}
    style={{ background: '#eff6ff', minWidth: 180, maxWidth: 240 }}>
    <Handle type="target" position={Position.Top}
      className="!bg-blue-400 !w-2 !h-2 !border-0"/>
    <div className="text-[11px] font-medium text-blue-800 leading-snug">{data.label}</div>
  </div>
);

const nodeTypes = {
  super_root: SuperRootNode,
  direction: DirectionNode,
  discipline: DisciplineNode,
  section: SectionNode,
  software: SoftwareNode,
  lit_main: LitMainNode,
  lit_add: LitAddNode,
};

/* ═══════════════════════════════════════════════════
   Layout Engine — Single Discipline
   ═══════════════════════════════════════════════════ */

const buildSingleLayout = (meta) => {
  const nodes = [];
  const edges = [];
  if (!meta) return { nodes, edges };

  const CX = 0, CY = 0;
  const sections = meta.sections || [];
  const software = meta.software || [];
  const litMain = (meta.literature?.main || []).slice(0, 6);
  const litAdd = (meta.literature?.additional || []).slice(0, 5);
  const category = meta.category || 'technical';
  const colors = getColors(category);
  const volPeriod = [meta.volume, meta.period].filter(v => v && v !== '-').join(' • ');

  nodes.push({
    id: 'root', type: 'discipline',
    position: { x: CX, y: CY },
    data: { label: truncate(meta.name, 42), sub: volPeriod || null,
            fullData: meta, category, period: meta.period, edu_level: meta.edu_level },
    draggable: true,
  });

  const sCount = sections.length || 1;
  const sRadius = Math.max(300, 220 + sCount * 30);
  const arcStart = Math.PI + 0.3;
  const arcEnd = 2 * Math.PI - 0.3;

  const swToSections = {};
  software.forEach((_, swi) => { swToSections[swi] = []; });

  sections.forEach((sec, i) => {
    const angle = sCount === 1 ? (arcStart + arcEnd) / 2
      : arcStart + (i / Math.max(sCount - 1, 1)) * (arcEnd - arcStart);
    const x = CX + sRadius * Math.cos(angle);
    const y = CY + sRadius * Math.sin(angle);
    const id = `sec-${i}`;
    const h = sec.hours || {};
    const totalH = parseH(h.lectures) + parseH(h.practice) + parseH(h.labs) + parseH(h.self_study);
    const linkedSw = sec.linked_software || [];
    linkedSw.forEach(swName => {
      const swi = software.indexOf(swName);
      if (swi >= 0 && swToSections[swi]) swToSections[swi].push(i);
    });
    nodes.push({
      id, type: 'section',
      position: { x: x - 80, y: y - 20 },
      data: { label: truncate(sec.name, 28), hours: totalH, swCount: linkedSw.length,
              sectionData: sec, index: i, category },
      draggable: true,
    });
    edges.push({
      id: `e-root-${id}`, source: 'root', sourceHandle: 'top', target: id,
      type: 'smoothstep',
      style: { stroke: colors.accent, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: colors.accent, width: 12, height: 12 },
    });
  });

  const swPlaced = new Set();
  software.forEach((sw, swi) => {
    const id = `sw-${swi}`;
    const linkedSecs = swToSections[swi] || [];
    let x, y;
    if (linkedSecs.length > 0) {
      const secNode = nodes.find(n => n.id === `sec-${linkedSecs[0]}`);
      if (secNode) {
        const dx = secNode.position.x - CX;
        const dy = secNode.position.y - CY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offsetDist = 140 + (swPlaced.size % 3) * 30;
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const stagger = (swPlaced.size % 2 === 0 ? 1 : -1) * 40;
        x = secNode.position.x + (dx / dist) * offsetDist + perpX * stagger;
        y = secNode.position.y + (dy / dist) * offsetDist + perpY * stagger;
      } else {
        x = CX + sRadius + 150;
        y = CY - 100 + swi * 60;
      }
    } else {
      x = CX + sRadius + 180;
      y = CY - ((software.length - 1) * 30) + [...swPlaced].length * 60;
    }
    nodes.push({
      id, type: 'software',
      position: { x, y },
      data: { label: truncate(sw, 20), fullName: sw,
              sections: linkedSecs.map(si => sections[si]?.name || '') },
      draggable: true,
    });
    if (linkedSecs.length > 0) {
      linkedSecs.forEach(secIdx => {
        edges.push({
          id: `e-sec${secIdx}-${id}`, source: `sec-${secIdx}`, sourceHandle: 'right',
          target: id, type: 'smoothstep',
          style: { stroke: '#34d399', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#34d399' },
        });
      });
    } else {
      edges.push({
        id: `e-root-${id}`, source: 'root', sourceHandle: 'right', target: id,
        type: 'smoothstep',
        style: { stroke: '#34d399', strokeWidth: 1.5, strokeDasharray: '4 3' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#34d399' },
      });
    }
    swPlaced.add(id);
  });

  const litY = CY + 180;
  litMain.forEach((lit, i) => {
    const id = `lm-${i}`;
    nodes.push({
      id, type: 'lit_main',
      position: { x: CX - 300 + (i % 2) * 240, y: litY + Math.floor(i / 2) * 80 },
      data: { label: truncate(getLitText(lit), 42), litData: lit },
      draggable: true,
    });
    edges.push({
      id: `e-root-${id}`, source: 'root', target: id, type: 'smoothstep',
      style: { stroke: '#c084fc', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#c084fc' },
      ...(i === 0 ? {
        label: 'осн. лит.',
        labelStyle: { fontSize: 9, fill: '#9333ea', fontWeight: 600 },
        labelBgStyle: { fill: '#faf5ff' }, labelBgPadding: [3, 5], labelBgBorderRadius: 3
      } : {}),
    });
  });

  litAdd.forEach((lit, i) => {
    const id = `la-${i}`;
    nodes.push({
      id, type: 'lit_add',
      position: { x: CX + 120 + (i % 2) * 240, y: litY + Math.floor(i / 2) * 80 },
      data: { label: truncate(getLitText(lit), 42), litData: lit },
      draggable: true,
    });
    edges.push({
      id: `e-root-${id}`, source: 'root', target: id, type: 'smoothstep',
      style: { stroke: '#93c5fd', strokeWidth: 1.5, strokeDasharray: '6 3' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#93c5fd' },
      ...(i === 0 ? {
        label: 'доп. лит.',
        labelStyle: { fontSize: 9, fill: '#3b82f6', fontWeight: 600 },
        labelBgStyle: { fill: '#eff6ff' }, labelBgPadding: [3, 5], labelBgBorderRadius: 3
      } : {}),
    });
  });

  return { nodes, edges };
};

/* ═══════════════════════════════════════════════════
   Layout Engine — Multi Discipline
   ═══════════════════════════════════════════════════ */

const buildMultiLayout = (disciplines, graphNodes, graphEdges) => {
  const nodes = [];
  const edges = [];
  if (!graphNodes || !graphEdges) return { nodes, edges };

  const CX = 0, CY = 0;
  const superRoot = graphNodes.find(n => n.type === 'super_root');
  if (superRoot) {
    nodes.push({
      id: superRoot.id, type: 'super_root',
      position: { x: CX - 100, y: CY },
      data: { label: superRoot.label, count: superRoot.data.count },
      draggable: true,
    });
  }

  const dirNodes = graphNodes.filter(n => n.type === 'direction');
  const dirSpacing = 600;

  dirNodes.forEach((dir, di) => {
    const dx = CX + (di - (dirNodes.length - 1) / 2) * dirSpacing;
    const dy = CY + 150;

    nodes.push({
      id: dir.id, type: 'direction',
      position: { x: dx - 90, y: dy },
      data: { label: truncate(dir.label, 35), count: dir.data.count },
      draggable: true,
    });

    if (superRoot) {
      edges.push({
        id: `e-sr-${dir.id}`, source: superRoot.id, target: dir.id,
        type: 'smoothstep',
        style: { stroke: '#6b7280', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
      });
    }

    const discEdges = graphEdges.filter(e => e.source === dir.id);
    const discIds = discEdges.map(e => e.target);

    discIds.forEach((discId, dci) => {
      const discNode = graphNodes.find(n => n.id === discId);
      if (!discNode) return;
      const cat = discNode.data.category || 'technical';
      const colors = getColors(cat);
      const ddx = dx + (dci - (discIds.length - 1) / 2) * 350;
      const ddy = dy + 200;

      nodes.push({
        id: discId, type: 'discipline',
        position: { x: ddx - 110, y: ddy },
        data: {
          label: truncate(discNode.label, 35), fullData: discNode.data,
          category: cat, period: discNode.data.period, edu_level: discNode.data.edu_level,
          sub: [discNode.data.volume, discNode.data.period]
            .filter(v => v && v !== '-').join(' • ') || null,
        },
        draggable: true,
      });

      edges.push({
        id: `e-${dir.id}-${discId}`, source: dir.id, target: discId,
        type: 'smoothstep',
        style: { stroke: colors.accent, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: colors.accent },
      });

      const secEdges = graphEdges.filter(
        e => e.source === discId && e.target.includes('sec')
      );
      const secCount = secEdges.length;
      const secRadius = Math.max(200, 150 + secCount * 20);

      secEdges.forEach((se, si) => {
        const secNode = graphNodes.find(n => n.id === se.target);
        if (!secNode) return;
        const angle = Math.PI + 0.4 + (si / Math.max(secCount - 1, 1)) * (Math.PI - 0.8);
        const sx = ddx + secRadius * Math.cos(angle);
        const sy = ddy + secRadius * Math.sin(angle);
        const h = secNode.data.hours || {};
        const totalH = parseH(h.lectures) + parseH(h.practice) +
                        parseH(h.labs) + parseH(h.self_study);
        nodes.push({
          id: secNode.id, type: 'section',
          position: { x: sx - 75, y: sy - 15 },
          data: {
            label: truncate(secNode.label, 25), hours: totalH,
            swCount: (secNode.data.linked_software || []).length,
            sectionData: secNode.data, index: si, category: cat,
          },
          draggable: true,
        });
        edges.push({
          id: `e-${discId}-${secNode.id}`, source: discId, sourceHandle: 'top',
          target: secNode.id, type: 'smoothstep',
          style: { stroke: colors.accent, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: colors.accent },
        });
      });

      const litEdges = graphEdges.filter(
        e => e.source === discId && (e.target.includes('lm') || e.target.includes('la'))
      );
      litEdges.forEach((le, li) => {
        const litNode = graphNodes.find(n => n.id === le.target);
        if (!litNode) return;
        const lx = ddx - 250 + (li % 2) * 200;
        const ly = ddy + secRadius + 100 + Math.floor(li / 2) * 70;
        const isMain = litNode.type === 'lit_main';
        nodes.push({
          id: litNode.id, type: litNode.type,
          position: { x: lx, y: ly },
          data: { label: truncate(litNode.label, 38), litData: litNode.data },
          draggable: true,
        });
        edges.push({
          id: `e-${discId}-${litNode.id}`, source: discId, target: litNode.id,
          type: 'smoothstep',
          style: {
            stroke: isMain ? '#c084fc' : '#93c5fd', strokeWidth: 1.5,
            ...(isMain ? {} : { strokeDasharray: '6 3' }),
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: isMain ? '#c084fc' : '#93c5fd' },
        });
      });
    });
  });

  const sharedEdges = graphEdges.filter(e => e.label === 'общий раздел');
  sharedEdges.forEach((se, si) => {
    if (nodes.find(n => n.id === se.source) && nodes.find(n => n.id === se.target)) {
      edges.push({
        id: `shared-${si}`, source: se.source, sourceHandle: 'left',
        target: se.target, targetHandle: 'target-top',
        type: 'smoothstep',
        style: { stroke: '#ef4444', strokeWidth: 2.5, strokeDasharray: '8 4' },
        label: '⚡ Общий раздел',
        labelStyle: { fontSize: 9, fill: '#dc2626', fontWeight: 700 },
        labelBgStyle: { fill: '#fef2f2' }, labelBgPadding: [4, 6], labelBgBorderRadius: 4,
        animated: true,
      });
    }
  });

  return { nodes, edges };
};

/* ═══════════════════════════════════════════════════
   LitCard Component
   ═══════════════════════════════════════════════════ */

const LitCard = ({ entry }) => {
  if (typeof entry === 'string') return <p className="text-sm text-gray-700">{entry}</p>;
  const tm = {
    book: ['📕 Книга', '#dbeafe', '#1e40af'],
    article: ['📄 Статья', '#ede9fe', '#5b21b6'],
    web: ['🌐 Веб', '#cffafe', '#155e75'],
    ebs: ['📚 ЭБС', '#fef3c7', '#92400e'],
    standard: ['📐 ГОСТ', '#fce7f3', '#9d174d'],
    thesis: ['🎓 Дисс.', '#f3f4f6', '#374151'],
    unknown: ['📝', '#f3f4f6', '#374151'],
  };
  const [label, bg, color] = tm[entry.entry_type] || tm.unknown;
  return (
    <div className="lit-card">
      <div className="flex items-start justify-between gap-2">
        <span className="lit-card__type" style={{ background: bg, color }}>{label}</span>
        {entry.year && <span className="lit-card__year">{entry.year}</span>}
      </div>
      {entry.authors?.length > 0 && (
        <p className="lit-card__authors">{entry.authors.join(', ')}</p>
      )}
      {entry.title && <p className="lit-card__title">{entry.title}</p>}
      {entry.publisher && <p className="lit-card__publisher">{entry.publisher}</p>}
      {entry.url && (
        <a href={entry.url} target="_blank" rel="noreferrer" className="lit-card__link">
          🔗 {entry.url}
        </a>
      )}
      {!entry.title && !entry.authors?.length && entry.raw && (
        <p className="text-xs text-gray-600 mt-1">{entry.raw}</p>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   Detail Panel
   ═══════════════════════════════════════════════════ */

const DetailPanel = ({ node, onClose }) => {
  if (!node) return null;
  const d = node.data;

  return (
    <div className="detail-panel">
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div/>
          <button onClick={onClose} className="btn btn--ghost btn--icon">
            <XIcon/>
          </button>
        </div>

        {/* Discipline detail */}
        {node.type === 'discipline' && d.fullData && (() => {
          const fd = d.fullData;
          const cat = fd.category || d.category || 'technical';
          const colors = getColors(cat);
          return (
            <div className="space-y-3">
              <span className="tag" style={{ background: colors.primaryLight, color: colors.text }}>
                {CATEGORY_LABELS[cat] || 'Дисциплина'}
              </span>
              <h3 className="text-sm font-bold text-gray-900">{fd.name}</h3>
              {fd.edu_level && (
                <div className="text-[11px] text-gray-600">
                  <span className="font-semibold">Уровень:</span> {fd.edu_level}
                </div>
              )}
              {fd.edu_program && (
                <div className="text-[11px] text-gray-600">
                  <span className="font-semibold">Программа:</span> {fd.edu_program}
                </div>
              )}
              {fd.direction && (
                <div className="text-[11px] text-gray-600">
                  <span className="font-semibold">Направление:</span> {fd.direction}
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap">
                {fd.volume && fd.volume !== '-' && (
                  <span className="tag" style={{ background: colors.ring, color: colors.text }}>
                    {fd.volume}
                  </span>
                )}
                {fd.period && fd.period !== '-' && (
                  <span className="tag" style={{ background: colors.ring, color: colors.text }}>
                    {fd.period}
                  </span>
                )}
              </div>
              {fd.volume_details && (
                <div>
                  <p className="section-label">Объём (детали)</p>
                  <p className="desc-box">{fd.volume_details}</p>
                </div>
              )}
              {fd.description && (
                <div>
                  <p className="section-label">Описание</p>
                  <p className="desc-box">{fd.description}</p>
                </div>
              )}
              {fd.goals && (
                <div>
                  <p className="section-label">Цели</p>
                  <p className="desc-box">{fd.goals}</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Section detail */}
        {node.type === 'section' && d.sectionData && (() => {
          const sec = d.sectionData;
          const h = sec.hours || {};
          const items = [
            { l: 'Лек', v: parseH(h.lectures), c: '#2563eb' },
            { l: 'Пр', v: parseH(h.practice), c: '#059669' },
            { l: 'Лаб', v: parseH(h.labs), c: '#d97706' },
            { l: 'СР', v: parseH(h.self_study), c: '#7c3aed' },
          ].filter(x => x.v > 0);
          const linkedSw = sec.linked_software || [];
          return (
            <div className="space-y-3">
              <span className="tag" style={{ background: '#ffedd5', color: '#9a3412' }}>
                Раздел {(d.index || 0) + 1}
              </span>
              <h3 className="text-sm font-bold text-gray-900 leading-snug">{sec.name}</h3>
              {items.length > 0 && (
                <div>
                  <p className="section-label">Часы</p>
                  <div className="info-grid">
                    {items.map(x => (
                      <div key={x.l} className="info-grid__item">
                        <div className="info-grid__value" style={{ color: x.c }}>{x.v}</div>
                        <div className="info-grid__label">{x.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {sec.content && (
                <div>
                  <p className="section-label">Содержание</p>
                  <p className="desc-box">{sec.content}</p>
                </div>
              )}
              {linkedSw.length > 0 && (
                <div>
                  <p className="section-label">ПО</p>
                  <div className="flex flex-wrap gap-1">
                    {linkedSw.map((sw, i) => (
                      <span key={i} className="tag"
                        style={{ background: '#ecfdf5', color: '#065f46' }}>
                        🔧 {sw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Software detail */}
        {node.type === 'software' && (
          <div className="space-y-3">
            <span className="tag" style={{ background: '#ecfdf5', color: '#065f46' }}>
              Программное обеспечение
            </span>
            <h3 className="text-sm font-bold text-gray-900">{d.fullName || d.label}</h3>
            {d.sections?.length > 0 && (
              <div>
                <p className="section-label">Используется в разделах</p>
                {d.sections.map((s, i) => (
                  <p key={i} className="text-xs text-gray-600 py-1 border-b border-gray-100
                    last:border-0">{s}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Literature detail */}
        {(node.type === 'lit_main' || node.type === 'lit_add') && d.litData && (
          <div className="space-y-3">
            <span className="tag"
              style={{ background: node.type === 'lit_main' ? '#faf5ff' : '#eff6ff',
                       color: node.type === 'lit_main' ? '#6b21a8' : '#1d4ed8' }}>
              {node.type === 'lit_main' ? 'Основная литература' : 'Дополнительная литература'}
            </span>
            <LitCard entry={d.litData}/>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   Toast Component
   ═══════════════════════════════════════════════════ */

const Toast = ({ message, type = 'info', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`toast toast--${type}`}>
      <div className="toast__inner">
        {type === 'success' && '✅'}
        {type === 'error' && '❌'}
        {type === 'info' && 'ℹ️'}
        <span>{message}</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   Main Flow Component (inside provider)
   ═══════════════════════════════════════════════════ */

const FlowInner = () => {
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [selectedFileIds, setSelectedFileIds] = useState(new Set());
  const [metadata, setMetadata] = useState(null);
  const [multiData, setMultiData] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [mode, setMode] = useState('single'); // 'single' | 'multi'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState(null);

  const { fitView } = useReactFlow();

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  // Load file list on mount
  useEffect(() => {
    axios.get(`${API}/api/files`)
      .then(r => setFiles(r.data))
      .catch(() => {});
  }, []);

  // Node/edge change handlers
  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []
  );
  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []
  );

  // Upload file
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axios.post(`${API}/api/analyze`, fd);
      const data = res.data;
      setMetadata(data.metadata);
      setActiveFileId(data.file_id);
      setMode('single');
      setMultiData(null);

      const layout = buildSingleLayout(data.metadata);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      setTimeout(() => fitView({ padding: 0.2 }), 100);

      // Refresh file list
      const filesRes = await axios.get(`${API}/api/files`);
      setFiles(filesRes.data);
      showToast(`«${data.metadata.name}» загружена`, 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Ошибка загрузки', 'error');
    } finally {
      setLoading(false);
    }
  }, [fitView, showToast]);

  // Select single file
  const handleSelectFile = useCallback(async (fileId) => {
    if (mode === 'multi') return;
    setLoading(true);
    setSelectedNode(null);
    try {
      const res = await axios.get(`${API}/api/files/${fileId}`);
      setMetadata(res.data.metadata);
      setActiveFileId(fileId);
      setMultiData(null);

      const layout = buildSingleLayout(res.data.metadata);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    } catch {
      showToast('Не удалось загрузить файл', 'error');
    } finally {
      setLoading(false);
    }
  }, [fitView, mode, showToast]);

  // Toggle file selection (multi mode)
  const handleToggleSelect = useCallback((fileId) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  // Delete file
  const handleDelete = useCallback(async (fileId, e) => {
    e?.stopPropagation();
    try {
      await axios.delete(`${API}/api/files/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      if (activeFileId === fileId) {
        setMetadata(null);
        setActiveFileId(null);
        setNodes([]);
        setEdges([]);
        setSelectedNode(null);
      }
      setSelectedFileIds(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      showToast('Файл удалён', 'info');
    } catch {
      showToast('Ошибка удаления', 'error');
    }
  }, [activeFileId, showToast]);

  // Build multi graph
  const handleBuildMulti = useCallback(async () => {
    if (selectedFileIds.size < 2) {
      showToast('Выберите минимум 2 файла', 'error');
      return;
    }
    setLoading(true);
    setSelectedNode(null);
    try {
      const res = await axios.post(`${API}/api/multi-graph`,
        [...selectedFileIds]
      );
      setMultiData(res.data);
      setMetadata(null);
      setActiveFileId(null);

      const layout = buildMultiLayout(
        res.data.disciplines,
        res.data.graph_nodes,
        res.data.graph_edges
      );
      setNodes(layout.nodes);
      setEdges(layout.edges);
      setTimeout(() => fitView({ padding: 0.15 }), 100);
      showToast(`Граф для ${res.data.disciplines.length} дисциплин построен`, 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Ошибка построения графа', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedFileIds, fitView, showToast]);

  // Node click
  const onNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  // Pane click — deselect
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Switch mode
  const handleModeChange = useCallback((newMode) => {
    setMode(newMode);
    setSelectedNode(null);
    if (newMode === 'single') {
      setSelectedFileIds(new Set());
      setMultiData(null);
    }
  }, []);

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header__left">
          <button className="btn btn--ghost btn--icon"
            onClick={() => setSidebarOpen(v => !v)}>
            <SidebarIcon/>
          </button>
          <div className="app-header__logo">
            <div className="app-header__logo-icon">S</div>
            <div>
              <div className="app-header__title">Sirius RPD</div>
              <div className="app-header__subtitle">Knowledge Graph Builder</div>
            </div>
          </div>
        </div>
        <div className="app-header__right">
          <div className="mode-toggle">
            <button
              className={`mode-toggle__option ${mode === 'single'
                ? 'mode-toggle__option--active' : ''}`}
              onClick={() => handleModeChange('single')}>
              Одна дисциплина
            </button>
            <button
              className={`mode-toggle__option ${mode === 'multi'
                ? 'mode-toggle__option--active' : ''}`}
              onClick={() => handleModeChange('multi')}>
              Сравнение
            </button>
          </div>
          {mode === 'multi' && selectedFileIds.size >= 2 && (
            <button className="btn btn--success btn--sm" onClick={handleBuildMulti}
              disabled={loading}>
              {loading ? <Spinner/> : null}
              Построить граф ({selectedFileIds.size})
            </button>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">
        {/* Sidebar */}
        <aside className={`sidebar ${!sidebarOpen ? 'sidebar--collapsed' : ''}`}>
          <div className="sidebar__header">
            <span className="sidebar__title">Файлы</span>
            <span className="sidebar__badge">{files.length}</span>
          </div>

          <div className="sidebar__content">
            {/* Upload zone */}
            <div className={`upload-zone ${loading ? 'upload-zone--loading' : ''}`}>
              <input type="file" accept=".pdf,.docx" onChange={handleUpload}
                disabled={loading}/>
              <div className="upload-zone__icon">
                {loading ? <Spinner/> : <UploadIcon/>}
              </div>
              <div className="upload-zone__title">
                {loading ? 'Обработка…' : 'Загрузить РПД'}
              </div>
              <div className="upload-zone__hint">PDF или DOCX</div>
              {loading && (
                <div className="progress-bar">
                  <div className="progress-bar__fill" style={{ width: '60%' }}/>
                </div>
              )}
            </div>

            {/* File list */}
            <div className="mt-3 space-y-1">
              {files.map(f => (
                <div key={f.id}
                  className={`file-card
                    ${activeFileId === f.id && mode === 'single' ? 'file-card--active' : ''}
                    ${selectedFileIds.has(f.id) ? 'file-card--selected' : ''}`}
                  onClick={() => mode === 'single' ? handleSelectFile(f.id)
                    : handleToggleSelect(f.id)}>
                  {mode === 'multi' && (
                    <div className={`file-card__checkbox
                      ${selectedFileIds.has(f.id) ? 'file-card__checkbox--checked' : ''}`}
                      onClick={(e) => { e.stopPropagation(); handleToggleSelect(f.id); }}>
                      {selectedFileIds.has(f.id) && <CheckIcon/>}
                    </div>
                  )}
                  <div className="file-card__header"
                    style={mode === 'multi' ? { marginLeft: 28 } : {}}>
                    <div className="file-card__name">
                      {f.discipline_name || f.filename}
                    </div>
                    <div className="file-card__actions">
                      <button className="btn btn--danger btn--icon"
                        onClick={(e) => handleDelete(f.id, e)}>
                        <TrashIcon/>
                      </button>
                    </div>
                  </div>
                  <div className="file-card__meta"
                    style={mode === 'multi' ? { marginLeft: 28 } : {}}>
                    <span className={`file-card__tag file-card__tag--${f.category || 'technical'}`}>
                      {CATEGORY_LABELS[f.category] || '📄'}
                    </span>
                    <span className="file-card__info">
                      {formatFileSize(f.file_size)}
                    </span>
                    <span className="file-card__info">
                      {formatDate(f.upload_date)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {files.length === 0 && (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">📂</div>
                <p className="text-xs text-gray-400">Нет загруженных файлов</p>
              </div>
            )}
          </div>
        </aside>

        {/* Flow canvas */}
        <div className="flow-canvas">
          {nodes.length > 0 ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.1}
              maxZoom={2}
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Controls showInteractive={false}/>
              <MiniMap
                nodeColor={(n) => {
                  if (n.type === 'discipline') {
                    const cat = n.data?.category || 'technical';
                    return getColors(cat).primary;
                  }
                  if (n.type === 'section') return '#60a5fa';
                  if (n.type === 'software') return '#34d399';
                  if (n.type === 'lit_main') return '#c084fc';
                  if (n.type === 'lit_add') return '#93c5fd';
                  if (n.type === 'super_root') return '#374151';
                  if (n.type === 'direction') return '#9ca3af';
                  return '#94a3b8';
                }}
                zoomable
                pannable
              />
              <Background variant="dots" gap={20} size={1} color="#e2e8f0"/>

              {/* Legend Panel */}
              <Panel position="top-left">
                <div className="legend">
                  <div className="legend__title">Легенда</div>
                  <div className="legend__item">
                    <div className="legend__dot" style={{ background: '#2563eb' }}/>
                    <span className="legend__label">Техн. дисциплина</span>
                  </div>
                  <div className="legend__item">
                    <div className="legend__dot" style={{ background: '#ea580c' }}/>
                    <span className="legend__label">Гуманитарная</span>
                  </div>
                  <div className="legend__item">
                    <div className="legend__dot" style={{ background: '#16a34a' }}/>
                    <span className="legend__label">Естественная</span>
                  </div>
                  <div className="legend__item">
                    <div className="legend__dot"
                      style={{ background: '#dbeafe', border: '1px solid #93c5fd' }}/>
                    <span className="legend__label">Разделы</span>
                  </div>
                  <div className="legend__item">
                    <div className="legend__dot" style={{ background: '#ecfdf5',
                      border: '1px solid #6ee7b7' }}/>
                    <span className="legend__label">ПО</span>
                  </div>
                  <div className="legend__item">
                    <div className="legend__dot" style={{ background: '#faf5ff',
                      border: '1px solid #d8b4fe' }}/>
                    <span className="legend__label">Литература</span>
                  </div>
                </div>
              </Panel>

              {/* Stats Panel */}
              <Panel position="top-right">
                <div className="legend" style={{ maxWidth: 160 }}>
                  <div className="legend__title">Статистика</div>
                  <div className="text-xs text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Узлы</span>
                      <span className="font-bold">{nodes.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Связи</span>
                      <span className="font-bold">{edges.length}</span>
                    </div>
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          ) : (
            <div className="empty-state">
              <div className="empty-state__icon">📊</div>
              <div className="empty-state__title">Граф знаний</div>
              <div className="empty-state__description">
                Загрузите РПД (PDF / DOCX) через панель слева, чтобы построить
                интерактивный граф дисциплины
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)}/>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   App wrapper with ReactFlowProvider
   ═══════════════════════════════════════════════════ */

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowInner/>
    </ReactFlowProvider>
  );
}