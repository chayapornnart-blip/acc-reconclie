import React, { useState, useEffect, useMemo } from 'react';
import { SAMPLE_BANK_CSV, SAMPLE_BOOK_CSV } from './constants';
import { parseCSV, reconcileData } from './utils';
import { ReconciliationItem, MatchStatus, DashboardStats } from './types';
import { GoogleGenAI, Type } from "@google/genai";

// --- Icons Components ---
const BankIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l8-4 8 4v14M5 10a17 17 0 0 1 14 0M10 21v-8a2 2 0 0 1 2-2h4"/></svg>
);
const BookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
);
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
);
const AlertIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
);
const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M9 3v4"/><path d="M3 9h4"/><path d="M3 5h4"/></svg>
);

const App: React.FC = () => {
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [filter, setFilter] = useState<MatchStatus | 'ALL'>('ALL');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const aiApiKey = import.meta.env?.VITE_API_KEY;
  
  useEffect(() => {
    const bankData = parseCSV(SAMPLE_BANK_CSV);
    const bookData = parseCSV(SAMPLE_BOOK_CSV);
    const reconciled = reconcileData(bankData, bookData);
    setItems(reconciled);
  }, []);

  const stats: DashboardStats = useMemo(() => {
    const totalBank = items.reduce((sum, item) => sum + (item.bankTransaction?.total_amount || 0), 0);
    const totalBook = items.reduce((sum, item) => sum + (item.bookEntry?.amount || 0), 0);
    const matchedCount = items.filter(i => i.status === MatchStatus.MATCHED).length;
    const discrepancyCount = items.filter(i => i.status === MatchStatus.DISCREPANCY_AMOUNT).length;
    const missingInBookCount = items.filter(i => i.status === MatchStatus.MISSING_IN_BOOK).length;
    
    return {
      totalBank,
      totalBook,
      matchedCount,
      discrepancyCount,
      missingInBookCount,
      accuracy: items.length ? (matchedCount / items.length) * 100 : 0
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === 'ALL') return items;
    return items.filter(item => item.status === filter);
  }, [items, filter]);

  const handleAnalyzeAI = async () => {
    if (!aiApiKey) {
        alert("กรุณาตั้งค่า VITE_API_KEY ในไฟล์ .env ของคุณ");
        return;
    }

    setIsAnalyzing(true);
    try {
        const ai = new GoogleGenAI({ apiKey: aiApiKey });
        
        const itemsToAnalyze = items.filter(i => 
            i.status === MatchStatus.DISCREPANCY_AMOUNT || 
            i.status === MatchStatus.MISSING_IN_BOOK ||
            i.status === MatchStatus.MISSING_IN_BANK
        );

        if (itemsToAnalyze.length === 0) {
            alert("No discrepancies to analyze!");
            setIsAnalyzing(false);
            return;
        }

        const payloadItems = itemsToAnalyze.slice(0, 20).map(i => ({
            id: i.id,
            status: i.status,
            bank_invoice: i.bankTransaction?.invoice_number,
            bank_amount: i.bankTransaction?.total_amount,
            bank_merchant: i.bankTransaction?.merchant_id,
            book_description: i.bookEntry?.description,
            book_amount: i.bookEntry?.amount,
            diff: i.difference
        }));

        const prompt = `
        You are an expert financial auditor. Review these reconciliation discrepancies between Bank Statement and General Ledger (Book).
        For each item, identify the likely cause of the error (e.g., Typo, Digit Transposition, Missing VAT recording, Timing difference).
        Return a JSON object where the keys are the item IDs and values are objects with:
        - analysis: Brief explanation of the error (max 10 words).
        - suggestedFix: Actionable recommendation (e.g., "Update Book amount to X").
        - confidence: Number 0-1 indicating confidence level.
        
        Data: ${JSON.stringify(payloadItems)}
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        analysisResults: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    id: { type: Type.STRING },
                                    analysis: { type: Type.STRING },
                                    suggestedFix: { type: Type.STRING },
                                    confidence: { type: Type.NUMBER }
                                }
                            }
                        }
                    }
                }
            }
        });

        const result = JSON.parse(response.text);
        
        const newItems = [...items];
        if (result.analysisResults) {
            result.analysisResults.forEach((res: any) => {
                const idx = newItems.findIndex(i => i.id === res.id);
                if (idx !== -1) {
                    newItems[idx] = {
                        ...newItems[idx],
                        aiAnalysis: res.analysis,
                        suggestedFix: res.suggestedFix,
                        confidence: res.confidence,
                        status: MatchStatus.POTENTIAL_ERROR
                    };
                }
            });
            setItems(newItems);
        }

    } catch (error) {
        console.error("AI Analysis failed:", error);
        alert("AI Analysis failed. See console for details.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-20">
      
      {/* Decorative Background */}
      <div className="absolute top-0 left-0 w-full h-64 bg-slate-900 -z-10"></div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-indigo-500 rounded-lg shadow-lg shadow-indigo-500/30">
                    <SparklesIcon />
                </div>
                <h1 className="text-3xl font-bold text-white tracking-tight">SmartRec</h1>
            </div>
            <p className="text-slate-300 font-light">AI-Powered Financial Reconciliation Dashboard</p>
          </div>
          <button 
            onClick={handleAnalyzeAI}
            disabled={isAnalyzing}
            className={`group relative flex items-center gap-2 px-6 py-3 rounded-full text-white font-medium shadow-xl transition-all duration-300
                ${isAnalyzing 
                    ? 'bg-slate-700 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 hover:scale-105 hover:shadow-indigo-500/40'}`}
          >
            {isAnalyzing ? (
                <>
                    <svg className="animate-spin h-5 w-5 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Processing...</span>
                </>
            ) : (
                <>
                    <SparklesIcon />
                    <span>AI Anomaly Detection</span>
                </>
            )}
            {!isAnalyzing && <div className="absolute inset-0 rounded-full ring-2 ring-white/20 group-hover:ring-white/40 transition-all"></div>}
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatsCard 
                title="Total Bank Amount" 
                value={stats.totalBank.toLocaleString('th-TH', { minimumFractionDigits: 2 })} 
                icon={<BankIcon />}
                theme="blue"
            />
            <StatsCard 
                title="Total Book Amount" 
                value={stats.totalBook.toLocaleString('th-TH', { minimumFractionDigits: 2 })} 
                icon={<BookIcon />}
                theme="indigo"
            />
            <StatsCard 
                title="Match Rate" 
                value={`${stats.accuracy.toFixed(1)}%`} 
                subValue={`${stats.matchedCount} transactions`}
                icon={<CheckIcon />}
                theme="emerald"
            />
            <StatsCard 
                title="Discrepancies" 
                value={`${stats.discrepancyCount + stats.missingInBookCount + stats.missingInBookCount}`}
                subValue="Action required"
                icon={<AlertIcon />}
                theme="rose"
            />
        </div>

        {/* Main Content Area */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden animate-fade-in">
            {/* Filter Tabs */}
            <div className="border-b border-slate-100 p-4 overflow-x-auto">
                <div className="flex gap-2">
                    {[
                        { key: 'ALL', label: 'All Transactions' },
                        { key: MatchStatus.MATCHED, label: 'Matched' },
                        { key: MatchStatus.DISCREPANCY_AMOUNT, label: 'Amount Mismatch' },
                        { key: MatchStatus.MISSING_IN_BOOK, label: 'Missing in Book' },
                        { key: MatchStatus.MISSING_IN_BANK, label: 'Missing in Bank' },
                        { key: MatchStatus.POTENTIAL_ERROR, label: '✨ AI Insights' },
                    ].map((tab: any) => (
                        <button
                            key={tab.key}
                            onClick={() => setFilter(tab.key)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap
                                ${filter === tab.key 
                                    ? 'bg-slate-800 text-white shadow-md transform scale-105' 
                                    : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-transparent hover:border-slate-200'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto custom-scrollbar" style={{ maxHeight: '650px' }}>
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Invoice / Ref</th>
                            <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Bank Amount</th>
                            <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Book Amount</th>
                            <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Difference</th>
                            <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Analysis</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {filteredItems.map(item => (
                            <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                                <td className="px-6 py-4">
                                    <StatusBadge status={item.status} />
                                </td>
                                <td className="px-6 py-4">
                                    <span className="font-mono text-sm text-slate-700 font-medium">
                                        {item.bankTransaction?.invoice_number || item.bookEntry?.description || '-'}
                                    </span>
                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                        {item.id.split('-')[0]} ID: {item.id.split('-')[2]}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {item.bankTransaction ? (
                                        <span className="font-mono text-sm text-slate-600">
                                            {item.bankTransaction.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                        </span>
                                    ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {item.bookEntry ? (
                                        <span className="font-mono text-sm text-slate-600">
                                            {item.bookEntry.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                        </span>
                                    ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {item.difference > 0.01 ? (
                                        <span className="font-mono text-sm font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded">
                                            {item.difference.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                        </span>
                                    ) : (
                                        <span className="text-emerald-500 text-xs font-medium">Balanced</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 min-w-[280px]">
                                    {item.aiAnalysis ? (
                                        <div className="relative bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 p-3 rounded-xl shadow-sm">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <SparklesIcon />
                                                <span className="text-xs font-bold text-violet-700">
                                                    AI Suggestion ({(item.confidence! * 100).toFixed(0)}%)
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-600 leading-relaxed mb-2">{item.aiAnalysis}</p>
                                            <div className="flex items-start gap-1.5 bg-white/60 p-1.5 rounded-lg border border-violet-100/50">
                                                <span className="text-[10px] uppercase font-bold text-emerald-600 mt-0.5">Fix:</span>
                                                <span className="text-xs font-medium text-slate-800">{item.suggestedFix}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-slate-300 text-xs italic group-hover:text-slate-400 transition-colors">
                                            No analysis available
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredItems.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <div className="bg-slate-50 p-4 rounded-full mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <p>No transactions found for this filter.</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

// --- Sub-components ---

const StatsCard = ({ title, value, subValue, icon, theme }: any) => {
    const themeStyles: any = {
        blue: "bg-blue-50 text-blue-600 border-blue-100",
        indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
        emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
        rose: "bg-rose-50 text-rose-600 border-rose-100"
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300 border border-slate-100 relative overflow-hidden">
            <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl ${themeStyles[theme]} bg-opacity-50`}>
                    {React.cloneElement(icon, { className: "w-6 h-6" })}
                </div>
            </div>
            <div>
                <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
                <h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3>
                {subValue && <p className={`text-xs mt-2 font-medium ${themeStyles[theme].replace('bg-', 'text-').split(' ')[1]}`}>{subValue}</p>}
            </div>
        </div>
    );
};

const StatusBadge = ({ status }: { status: MatchStatus }) => {
    const config = {
        [MatchStatus.MATCHED]: { color: 'bg-emerald-100 text-emerald-700 border-emerald-200', text: 'Matched', icon: '●' },
        [MatchStatus.DISCREPANCY_AMOUNT]: { color: 'bg-amber-50 text-amber-700 border-amber-200', text: 'Mismatch', icon: '⚠️' },
        [MatchStatus.MISSING_IN_BOOK]: { color: 'bg-rose-50 text-rose-700 border-rose-200', text: 'Missing in Book', icon: '✕' },
        [MatchStatus.MISSING_IN_BANK]: { color: 'bg-orange-50 text-orange-700 border-orange-200', text: 'Missing in Bank', icon: '?' },
        [MatchStatus.POTENTIAL_ERROR]: { color: 'bg-violet-50 text-violet-700 border-violet-200', text: 'AI Detected', icon: '✨' },
    }[status] || { color: 'bg-gray-100 text-gray-700', text: status, icon: '•' };

    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${config.color}`}>
            <span className="text-[10px]">{config.icon}</span>
            {config.text}
        </span>
    );
}

export default App;