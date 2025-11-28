import React, { useState, useEffect, useMemo } from 'react';
import { SAMPLE_BANK_CSV, SAMPLE_BOOK_CSV } from './constants';
import { parseCSV, reconcileData } from './utils';
import { ReconciliationItem, MatchStatus, DashboardStats } from './types';
import { GoogleGenAI, Type } from "@google/genai";

const App: React.FC = () => {
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [filter, setFilter] = useState<MatchStatus | 'ALL'>('ALL');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const aiApiKey = import.meta.env.VITE_API_KEY;
  
  // Initialize Data
  useEffect(() => {
    const bankData = parseCSV(SAMPLE_BANK_CSV);
    const bookData = parseCSV(SAMPLE_BOOK_CSV);
    const reconciled = reconcileData(bankData, bookData);
    setItems(reconciled);
  }, []);

  // Calculate Stats
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

  // AI Analysis Handler
  const handleAnalyzeAI = async () => {
    if (!aiApiKey) {
        alert("กรุณาตั้งค่า VITE_API_KEY ในไฟล์ .env ของคุณ");
        return;
    }

    setIsAnalyzing(true);
    try {
        const ai = new GoogleGenAI({ apiKey: aiApiKey });
        
        // Filter items that need analysis (Discrepancies and Missing)
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

        // Limit payload size for demo purposes (take top 20 problematic items)
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
        - analysis: Brief explanation of the error.
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
        
        // Merge results back into items
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
                        status: MatchStatus.POTENTIAL_ERROR // Upgrade status to indicate AI found something
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
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">SmartRec 🤖</h1>
            <p className="text-slate-500">AI-Powered Financial Reconciliation Dashboard</p>
          </div>
          <button 
            onClick={handleAnalyzeAI}
            disabled={isAnalyzing}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg text-white font-medium shadow-lg transition-all
                ${isAnalyzing ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-xl'}`}
          >
            {isAnalyzing ? (
                <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Analyzing with Gemini...
                </>
            ) : (
                <>
                    <span>✨ Detect Anomalies with AI</span>
                </>
            )}
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <p className="text-sm font-medium text-slate-500">Total Bank Amount</p>
                <p className="text-2xl font-bold text-slate-800">{stats.totalBank.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <p className="text-sm font-medium text-slate-500">Total Book Amount</p>
                <p className="text-2xl font-bold text-slate-800">{stats.totalBook.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <p className="text-sm font-medium text-slate-500">Match Rate</p>
                <div className="flex items-end gap-2">
                    <p className="text-2xl font-bold text-emerald-600">{stats.accuracy.toFixed(1)}%</p>
                    <p className="text-sm text-slate-400 mb-1">({stats.matchedCount} items)</p>
                </div>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <p className="text-sm font-medium text-slate-500">Discrepancies</p>
                <p className="text-2xl font-bold text-red-600">{stats.discrepancyCount + stats.missingInBookCount}</p>
            </div>
        </div>

        {/* Main Content Area */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Filter Tabs */}
            <div className="border-b border-slate-200 flex p-4 gap-2 overflow-x-auto">
                {[
                    { key: 'ALL', label: 'All Transactions' },
                    { key: MatchStatus.MATCHED, label: 'Matched', color: 'bg-emerald-100 text-emerald-700' },
                    { key: MatchStatus.DISCREPANCY_AMOUNT, label: 'Amount Mismatch', color: 'bg-yellow-100 text-yellow-700' },
                    { key: MatchStatus.MISSING_IN_BOOK, label: 'Missing in Book', color: 'bg-red-100 text-red-700' },
                    { key: MatchStatus.MISSING_IN_BANK, label: 'Missing in Bank', color: 'bg-orange-100 text-orange-700' },
                    { key: MatchStatus.POTENTIAL_ERROR, label: 'AI Detected Errors', color: 'bg-purple-100 text-purple-700' },
                ].map((tab: any) => (
                    <button
                        key={tab.key}
                        onClick={() => setFilter(tab.key)}
                        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors
                            ${filter === tab.key 
                                ? 'bg-slate-900 text-white' 
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto custom-scrollbar" style={{ maxHeight: '600px' }}>
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-3 font-medium">Status</th>
                            <th className="px-6 py-3 font-medium">Invoice / Ref</th>
                            <th className="px-6 py-3 font-medium text-right">Bank Amount</th>
                            <th className="px-6 py-3 font-medium text-right">Book Amount</th>
                            <th className="px-6 py-3 font-medium text-right">Difference</th>
                            <th className="px-6 py-3 font-medium">AI Insight</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredItems.map(item => (
                            <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4">
                                    <StatusBadge status={item.status} />
                                </td>
                                <td className="px-6 py-4 font-mono text-slate-600">
                                    {item.bankTransaction?.invoice_number || item.bookEntry?.description || '-'}
                                </td>
                                <td className="px-6 py-4 text-right font-mono">
                                    {item.bankTransaction 
                                        ? item.bankTransaction.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })
                                        : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-6 py-4 text-right font-mono">
                                    {item.bookEntry 
                                        ? item.bookEntry.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })
                                        : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-6 py-4 text-right font-mono">
                                    {item.difference > 0 ? (
                                        <span className="text-red-500 font-semibold">
                                            {item.difference.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                        </span>
                                    ) : (
                                        <span className="text-slate-300">-</span>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    {item.aiAnalysis ? (
                                        <div className="bg-purple-50 border border-purple-100 p-3 rounded-lg max-w-sm">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold text-purple-700 bg-purple-200 px-1.5 py-0.5 rounded">
                                                    {(item.confidence! * 100).toFixed(0)}% Conf
                                                </span>
                                                <span className="text-xs text-purple-800 font-medium">AI Suggestion</span>
                                            </div>
                                            <p className="text-xs text-slate-700 mb-1">{item.aiAnalysis}</p>
                                            <p className="text-xs font-semibold text-emerald-600">➜ Fix: {item.suggestedFix}</p>
                                        </div>
                                    ) : (
                                        <span className="text-slate-400 text-xs">-</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredItems.length === 0 && (
                    <div className="p-12 text-center text-slate-400">
                        No transactions found for this filter.
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: MatchStatus }) => {
    switch (status) {
        case MatchStatus.MATCHED:
            return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">MATCHED</span>;
        case MatchStatus.DISCREPANCY_AMOUNT:
            return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">AMOUNT MISMATCH</span>;
        case MatchStatus.MISSING_IN_BOOK:
            return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">MISSING IN BOOK</span>;
        case MatchStatus.MISSING_IN_BANK:
            return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">MISSING IN BANK</span>;
        case MatchStatus.POTENTIAL_ERROR:
            return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">AI DETECTED</span>;
        default:
            return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
}

export default App;
