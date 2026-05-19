/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell 
} from 'recharts';
import { 
  LayoutDashboard, 
  Truck, 
  CheckCircle2, 
  Search,
  History,
  Settings,
  ChevronRight,
  Filter,
  Check,
  X,
  Camera,
  Loader2
} from 'lucide-react';
import { VehicleData } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from './firebase';
import { collection, onSnapshot, updateDoc, doc, addDoc, query, deleteDoc, writeBatch, getDocs } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to sanitize plate
const sanitizePlate = (plate: string) => plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

// Toggle Component for Mobile
const Toggle = ({ active, onClick, label, activeColor = "bg-stone-800" }: { active: boolean, onClick: () => void, label: string, activeColor?: string }) => (
  <button 
    onClick={onClick}
    className="flex flex-col items-center gap-1.5 grayscale-0 active:scale-95 transition-transform"
  >
    <div className={cn(
      "w-12 h-6 rounded-full p-1 transition-colors duration-300 relative",
      active ? activeColor : "bg-stone-200"
    )}>
      <div className={cn(
        "w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300",
        active ? "translate-x-6" : "translate-x-0"
      )} />
    </div>
    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{label}</span>
  </button>
);

export default function App() {
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list' | 'import' | 'settings'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPatio, setFilterPatio] = useState<'all' | 'sim' | 'nao'>('all');
  const [filterAssinado, setFilterAssinado] = useState<'all' | 'sim' | 'nao'>('all');
  const [importText, setImportText] = useState('');
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingAI(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      try {
        const response = await fetch('/api/import-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 })
        });
        const data = await response.json();
        if (data.vehicles) {
          for (const v of data.vehicles) {
            await addDoc(collection(db, 'vehicles'), {
              cavalo: sanitizePlate(v.cavalo),
              carreta: sanitizePlate(v.carreta),
              destino: v.destino,
              estaNoPatio: false,
              assinado: false
            });
          }
          setActiveTab('list');
        } else if (data.error) {
           alert(`Erro: ${data.message || data.error}`);
        }
      } catch (error) {
        console.error('AI Import Error:', error);
        alert('Erro ao processar imagem. Verifique se o servidor está funcionando e se a chave API está configurada.');
      } finally {
        setIsProcessingAI(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const updateVehicle = async (id: string, field: keyof Pick<VehicleData, 'estaNoPatio' | 'assinado'>, value: boolean) => {
    const vehicleRef = doc(db, 'vehicles', id);
    await updateDoc(vehicleRef, { [field]: value });
  };

  // Sync Data with Firestore
  useEffect(() => {
    let unsubscribeSnap: any;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        // Logged in
        const q = query(collection(db, 'vehicles'));
        unsubscribeSnap = onSnapshot(q, (snapshot) => {
          const vehiclesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as VehicleData[];
          setVehicles(vehiclesData);
        }, (err) => {
           console.error("Snapshot error:", err);
        });
      } else {
        // Not logged in, try signing in
        signInAnonymously(auth).catch((err) => {
          if (err.code === 'auth/admin-restricted-operation') {
            console.error("Anonymous auth not enabled in Firebase project.", err);
          } else {
            console.error("Auth error:", err);
          }
        });
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnap) unsubscribeSnap();
    };
  }, []);

  const handleImport = async () => {
    if (!importText.trim()) return;

    const lines = importText.split('\n');
    let importedCount = 0;

    for (const line of lines) {
      const columns = line.split('\t');
      if (columns.length < 15) continue; // Basic sanity check

      const origem = columns[1]?.toUpperCase() || '';
      const cavalo = sanitizePlate(columns[12] || '');
      const carreta = sanitizePlate(columns[13] || '');
      const destino = columns[10] || '';
      const termo = columns[32]?.toLowerCase() || '';

      // Filters:
      // 1. Must be Santa Luzia
      // 2. Termo cannot be 'sim'
      // 3. Ignore Viana / Montes Claros (handled by step 1, but being explicit)
      const isSantaLuzia = origem.includes('SANTA LUZIA');
      const isViana = origem.includes('VIANA');
      const isMontesClaros = origem.includes('MONTES CLAROS');
      const hasTermo = termo === 'sim';

      if (isSantaLuzia && !isViana && !isMontesClaros && !hasTermo) {
        await addDoc(collection(db, 'vehicles'), {
          cavalo,
          carreta,
          destino,
          estaNoPatio: false, // Default state
          assinado: false     // Default state
        });
        importedCount++;
      }
    }

    if (importedCount > 0) {
      setImportText('');
      setActiveTab('list');
      alert(`${importedCount} veículos importados com sucesso de Santa Luzia!`);
    } else {
      alert('Nenhum veículo válido de Santa Luzia (sem termo) foi encontrado nos dados colados.');
    }
  };

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      const matchesSearch = v.cavalo.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          v.carreta.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          v.destino.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesPatio = filterPatio === 'all' ? true : (filterPatio === 'sim' ? v.estaNoPatio : !v.estaNoPatio);
      const matchesAssinado = filterAssinado === 'all' ? true : (filterAssinado === 'sim' ? v.assinado : !v.assinado);

      return matchesSearch && matchesPatio && matchesAssinado;
    });
  }, [vehicles, searchTerm, filterPatio, filterAssinado]);

  // Stats Logic
  const stats = useMemo(() => {
    const total = vehicles.length;
    const inPatio = vehicles.filter(v => v.estaNoPatio).length;
    const signed = vehicles.filter(v => v.assinado).length;
    return { total, inPatio, signed };
  }, [vehicles]);

  const destinoData = useMemo(() => {
    const counts: Record<string, number> = {};
    vehicles.forEach(v => {
      counts[v.destino] = (counts[v.destino] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [vehicles]);

  return (
    <div className="min-h-screen pb-[80px] bg-rustic-50">
      {/* Search Header */}
      <div className="sticky top-0 z-40 bg-rustic-900 backdrop-blur-xl px-6 pt-12 pb-6 flex flex-col gap-4 border-b border-white/10 shadow-2xl">
        <div className="flex justify-between items-end">
          <div className="space-y-0.5">
            <h2 className="font-serif italic text-sm text-rustic-200/80 leading-none">Painel Logístico</h2>
            <h1 className="text-2xl font-black tracking-tight text-white leading-none">Pátio Santa Luzia</h1>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rustic-600 to-rustic-800 flex items-center justify-center text-white font-black shadow-lg shadow-rustic-900/20 transform rotate-3 border border-white/20">
            3C
          </div>
        </div>
        
        <div className="relative mt-2">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50" size={18} />
          <input 
            type="text" 
            placeholder="Buscar placa ou destino..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-rustic-800 border border-white/10 rounded-2xl pl-12 pr-4 py-4 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-rustic-500 transition-all shadow-inner"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest pl-1">No Pátio?</p>
            <select 
              value={filterPatio}
              onChange={(e) => setFilterPatio(e.target.value as any)}
              className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rustic-500 appearance-none font-black"
            >
              <option value="all" className="text-rustic-900">Todos</option>
              <option value="sim" className="text-rustic-900">Sim</option>
              <option value="nao" className="text-rustic-900">Não</option>
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest pl-1">Assinado?</p>
            <select 
              value={filterAssinado}
              onChange={(e) => setFilterAssinado(e.target.value as any)}
              className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rustic-500 appearance-none font-black"
            >
              <option value="all" className="text-rustic-900">Todos</option>
              <option value="sim" className="text-rustic-900">Sim</option>
              <option value="nao" className="text-rustic-900">Não</option>
            </select>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'dashboard' && (
          <motion.div 
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="px-6 py-6 space-y-6"
          >
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-rustic-800 rounded-3xl p-6 text-white shadow-2xl shadow-rustic-900/30 overflow-hidden relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                <Truck className="absolute -right-4 -bottom-4 text-white/5 group-hover:scale-110 transition-transform duration-500" size={100} />
                <p className="text-[10px] font-black opacity-60 uppercase tracking-[0.2em] mb-1">Cargas</p>
                <p className="text-4xl font-black mb-4">{stats.total}</p>
                <div className="flex items-center gap-1 text-[10px] font-black text-white bg-white/10 w-fit px-3 py-1 rounded-full border border-white/10">
                  SISTEMA
                </div>
              </div>
              <div className="bg-gradient-to-br from-rustic-600 to-rustic-800 rounded-3xl p-6 text-white shadow-2xl shadow-rustic-600/30 overflow-hidden relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                <CheckCircle2 className="absolute -right-4 -bottom-4 text-white/5 group-hover:scale-110 transition-transform duration-500" size={100} />
                <p className="text-[10px] font-black opacity-60 uppercase tracking-[0.2em] mb-1">Ocupação</p>
                <p className="text-4xl font-black mb-4">{stats.inPatio}</p>
                <div className="flex items-center gap-1 text-[10px] font-black text-white bg-white/20 w-fit px-3 py-1 rounded-full border border-white/10">
                  NO PÁTIO
                </div>
              </div>
            </div>

            {/* Progress Summary */}
            <div className="bg-stone-50 rounded-[2rem] p-6 border border-stone-200/50 shadow-xl shadow-rustic-900/5 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-rustic-900 font-bold">Fluxo de Assinaturas</h3>
                <span className="text-xs font-black text-rustic-600">{Math.round((stats.signed / (stats.total || 1)) * 100)}%</span>
              </div>
              <div className="h-3 w-full bg-rustic-100 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(stats.signed / (stats.total || 1)) * 100}%` }}
                  className="h-full bg-rustic-600 rounded-full shadow-[0_0_10px_rgba(2,132,199,0.3)]"
                />
              </div>
              <div className="flex justify-between text-[10px] font-black text-stone-400 uppercase tracking-widest">
                <span>{stats.signed} ASSINADOS</span>
                <span>{stats.total - stats.signed} PENDENTES</span>
              </div>
            </div>

            {/* Charts Section */}
            <div className="space-y-4">
               <div className="bg-stone-50 rounded-[2rem] p-6 border border-stone-200/50 shadow-xl shadow-rustic-900/5">
                <h3 className="font-serif italic text-rustic-800 font-bold mb-6">Top Destinos</h3>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={destinoData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" />
                      <XAxis 
                        dataKey="name" 
                        fontSize={10} 
                        fontWeight={900}
                        tickMargin={10} 
                        axisLine={false} 
                        tick={{ fill: '#64748b' }}
                      />
                      <Bar dataKey="value" fill="#0f172a" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-stone-50 rounded-[2rem] p-6 border border-stone-200/50 shadow-xl shadow-rustic-900/5 flex items-center gap-6">
                <div className="w-24 h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Assinado', value: stats.signed },
                          { name: 'Pendente', value: stats.total - stats.signed }
                        ]}
                        innerRadius={30}
                        outerRadius={45}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        <Cell fill="#0284c7" />
                        <Cell fill="#f1f5f9" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-3">
                  <h3 className="font-serif italic text-rustic-800 font-bold leading-none">Status Geral</h3>
                  <div className="grid grid-cols-1 gap-2">
                     <div className="flex items-center gap-2">
                       <div className="w-2.5 h-2.5 rounded-full bg-rustic-600 shadow-[0_0_8px_rgba(2,132,199,0.4)]" />
                       <span className="text-[10px] font-black text-stone-600 uppercase tracking-wide">Assinados: {stats.signed}</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <div className="w-2.5 h-2.5 rounded-full bg-stone-200" />
                       <span className="text-[10px] font-black text-stone-400 uppercase tracking-wide">Aguardando: {stats.total - stats.signed}</span>
                     </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'list' && (
          <motion.div 
            key="list"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="px-6 py-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400">STATUS ATUAL</span>
                <h3 className="text-sm font-black text-rustic-900 uppercase">Veículos em Pátio</h3>
              </div>
              <div className="bg-stone-100 flex-none px-4 py-2 rounded-2xl text-stone-600 border border-stone-200 shadow-sm flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black tracking-tight">{filteredVehicles.length} REGISTROS</span>
              </div>
            </div>

            {filteredVehicles.map((v) => (
              <motion.div 
                layout
                key={v.id}
                className="bg-stone-50 rounded-[2.5rem] p-7 border border-stone-200/60 shadow-xl shadow-rustic-900/5 flex flex-col gap-6 relative overflow-hidden group"
              >
                <div className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-b from-rustic-600 to-rustic-800" />
                
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <p className="text-[11px] font-black text-rustic-600 uppercase tracking-[0.25em] leading-tight">{v.destino}</p>
                    <h3 className="text-3xl font-black text-rustic-900 font-mono tracking-tighter leading-none">{v.cavalo}</h3>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right bg-rustic-50 px-3 py-2 rounded-xl border border-rustic-100">
                      <p className="text-[9px] font-black text-stone-400 uppercase tracking-widest leading-tight mb-1">Carreta</p>
                      <p className="text-sm font-black text-rustic-900 font-mono leading-none">{v.carreta}</p>
                    </div>
                    {v.assinado && (
                      <button 
                        onClick={() => deleteDoc(doc(db, 'vehicles', v.id))}
                        className="text-[10px] font-black text-red-500 uppercase tracking-wider hover:text-red-700"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => updateVehicle(v.id, 'estaNoPatio', !v.estaNoPatio)}
                    className={cn(
                      "flex items-center justify-center gap-2 py-4.5 rounded-[1.25rem] text-[11px] font-black uppercase tracking-wider transition-all border shadow-sm active:scale-95",
                      v.estaNoPatio ? "bg-rustic-600 text-white border-rustic-600 shadow-xl shadow-rustic-600/20" : "bg-white text-stone-600 border-stone-200 hover:border-rustic-200"
                    )}
                  >
                    {v.estaNoPatio ? <Check size={18} strokeWidth={3} /> : <X size={18} strokeWidth={3} />}
                    No Pátio
                  </button>
                  <button 
                    onClick={() => updateVehicle(v.id, 'assinado', !v.assinado)}
                    className={cn(
                      "flex items-center justify-center gap-2 py-4.5 rounded-[1.25rem] text-[11px] font-black uppercase tracking-wider transition-all border shadow-sm active:scale-95",
                      v.assinado ? "bg-rustic-800 text-white border-rustic-800 shadow-xl shadow-rustic-900/20" : "bg-white text-stone-600 border-stone-200 hover:border-rustic-200"
                    )}
                  >
                    {v.assinado ? <Check size={18} strokeWidth={3} /> : <X size={18} strokeWidth={3} />}
                    Assinado
                  </button>
                </div>
              </motion.div>
            ))}
            
            {filteredVehicles.length === 0 && (
              <div className="py-20 text-center">
                <Truck className="mx-auto text-stone-200 mb-4" size={48} />
                <p className="font-serif italic text-stone-400">Nenhum veículo encontrado...</p>
                <button 
                  onClick={() => setActiveTab('import')}
                  className="mt-4 text-xs font-bold text-rustic-600 underline"
                >
                  Colar dados da planilha
                </button>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'import' && (
          <motion.div 
            key="import"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="px-6 py-8 space-y-6"
          >
            <div className="bg-stone-50 rounded-[2.5rem] p-8 border border-stone-200 shadow-xl shadow-rustic-900/5 space-y-8">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-rustic-600">
                    <History size={16} strokeWidth={3} />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em]">Importação Inteligente</span>
                  </div>
                  <h3 className="text-2xl font-black text-rustic-900 font-serif italic">Carregar Dados</h3>
                  <p className="text-xs text-stone-500 leading-relaxed max-w-[80%]">
                    Use a IA para ler fotos da planilha ou cole os dados do Excel manualmente.
                  </p>
                </div>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingAI}
                  className="w-16 h-16 rounded-3xl bg-rustic-600 flex items-center justify-center text-white shadow-2xl shadow-rustic-600/40 active:scale-95 transition-all disabled:opacity-50 ring-4 ring-rustic-100"
                >
                  {isProcessingAI ? <Loader2 className="animate-spin" size={28} /> : <Camera size={28} />}
                </button>
              </div>

              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleCapture}
                accept="image/*"
                capture="environment"
                className="hidden"
              />
              
              <div className="space-y-2">
                <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Entrada de Texto</p>
                <div className="relative group">
                  <textarea 
                    className="w-full h-64 bg-rustic-50 border-2 border-stone-100 rounded-[2rem] p-6 text-xs font-mono focus:outline-none focus:border-rustic-600 transition-all placeholder:text-stone-300"
                    placeholder="Cole aqui os dados da planilha..."
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                  {isProcessingAI && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-[4px] rounded-[2rem] flex flex-col items-center justify-center gap-4">
                      <div className="w-12 h-12 bg-rustic-600 rounded-2xl flex items-center justify-center shadow-lg animate-bounce">
                        <Loader2 className="animate-spin text-white" size={24} />
                      </div>
                      <p className="text-[11px] font-black text-rustic-900 uppercase tracking-[0.2em]">IA Analisando Documento...</p>
                    </div>
                  )}
                </div>
              </div>
              
              <button 
                onClick={handleImport}
                disabled={!importText.trim() || isProcessingAI}
                className="w-full bg-rustic-800 text-white py-5 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-[11px] hover:bg-rustic-900 transition-all shadow-xl shadow-rustic-900/20 active:scale-[0.98] disabled:opacity-50"
              >
                Sincronizar com Pátio
              </button>
            </div>
          </motion.div>
        )}

        {activeTab === 'settings' && (
          <motion.div 
            key="settings"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="px-6 py-8 space-y-6"
          >
            <div className="bg-stone-50 rounded-[2.5rem] p-8 border border-stone-200 shadow-xl shadow-rustic-900/5 space-y-10">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-stone-400">
                  <Settings size={16} strokeWidth={3} />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em]">Preferências</span>
                </div>
                <h3 className="text-2xl font-black text-rustic-900 font-serif italic">Configurações</h3>
                <p className="text-xs text-stone-500 leading-relaxed font-bold">Gerencie o ecossistema do aplicativo.</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Manutenção</p>
                  <button 
                    onClick={async () => {
                      if(confirm('⚠️ ATENÇÃO: Esta ação irá apagar TODOS os veículos salvos. Deseja continuar?')) {
                        const batch = writeBatch(db);
                        const qs = await getDocs(collection(db, 'vehicles'));
                        qs.forEach(doc => batch.delete(doc.ref));
                        await batch.commit();
                      }
                    }}
                    className="w-full flex items-center justify-between p-5 bg-stone-50 border border-stone-100 rounded-2xl active:scale-[0.98] transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-2xl bg-red-50 flex items-center justify-center text-red-500 group-hover:bg-red-500 group-hover:text-white transition-all shadow-sm">
                        <X size={22} strokeWidth={3} />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-black text-rustic-900 uppercase tracking-tight">Zerar Banco de Dados</p>
                        <p className="text-[10px] font-bold text-stone-400">Remove todos os registros salvos</p>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-stone-300" />
                  </button>
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Sistema</p>
                  <div className="w-full flex items-center justify-between p-5 bg-stone-50 border border-stone-100 rounded-2xl">
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-2xl bg-rustic-100 flex items-center justify-center text-rustic-600 shadow-sm">
                        <Filter size={22} strokeWidth={3} />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-black text-rustic-900 uppercase tracking-tight">Filtros de Importação</p>
                        <p className="text-[10px] font-bold text-stone-400">Automatizar Santa Luzia</p>
                      </div>
                    </div>
                    <div className="w-12 h-7 bg-rustic-600 rounded-full relative p-1 cursor-pointer shadow-inner">
                      <div className="grow" />
                      <div className="w-5 h-5 bg-white rounded-full absolute right-1 shadow-md" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-stone-100 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                   <div className="w-2 h-2 rounded-full bg-emerald-500" />
                   <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em]">Servidor Online</span>
                </div>
                <p className="text-stone-300 text-[10px] font-bold tracking-[0.4em]">v2.2.0 • 3CORACOES</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        {[
          { id: 'dashboard', icon: LayoutDashboard, label: 'Resumo' },
          { id: 'list', icon: Truck, label: 'Pátio' },
          { id: 'import', icon: History, label: 'Importar' },
          { id: 'settings', icon: Settings, label: 'Ajustes' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id as any)}
            className={cn(
              "flex flex-col items-center gap-1 px-4 transition-all relative",
              activeTab === item.id ? "text-rustic-900" : "text-stone-400 hover:text-stone-600"
            )}
          >
            {activeTab === item.id && (
              <motion.div 
                layoutId="nav-glow"
                className="absolute -top-[1.2rem] w-8 h-1 bg-rustic-900 rounded-full shadow-[0_0_10px_rgba(15,23,42,0.3)]"
              />
            )}
            <item.icon size={22} strokeWidth={activeTab === item.id ? 2.5 : 2} className={cn("transition-transform", activeTab === item.id ? "scale-110" : "scale-100")} />
            <span className={cn("text-[9px] font-black uppercase tracking-widest transition-opacity", activeTab === item.id ? "opacity-100" : "opacity-40")}>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
