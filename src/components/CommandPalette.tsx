import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, Receipt, Wallet, Settings, TrendingUp, Plus, Repeat, Lock, Export, Moon, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';

interface CommandItem {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  action: () => void;
  category: 'transaction' | 'account' | 'setting' | 'action';
}

export default function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const data = useLiveQuery(async () => {
    const [transactions, accounts, categories] = await Promise.all([
      db.entries.toArray(),
      db.accounts.toArray(),
      db.categories.toArray()
    ]);
    return { transactions, accounts, categories };
  }, []);

  const items: CommandItem[] = useMemo(() => {
    if (!data) return [];

    const results: CommandItem[] = [];

    // Transactions
    data.transactions.slice(0, 20).forEach((t) => {
      if (search && !t.note?.toLowerCase().includes(search.toLowerCase()) && 
          !t.amount.toString().includes(search)) return;
      
      results.push({
        id: `tx-${t.id}`,
        title: t.note || 'Untitled Transaction',
        subtitle: `₹${t.amount} • ${t.date}`,
        icon: <Receipt size={16} />,
        category: 'transaction',
        action: () => {
          navigate('/transactions');
          onClose();
        }
      });
    });

    // Accounts
    data.accounts.forEach((a) => {
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return;
      
      results.push({
        id: `acc-${a.id}`,
        title: a.name,
        subtitle: `${a.type} • ₹${a.balance || 0}`,
        icon: <Wallet size={16} />,
        category: 'account',
        action: () => {
          navigate('/settings');
          onClose();
        }
      });
    });

    // Settings & Actions
    const actions = [
      { id: 'add-tx', title: 'Add Transaction', subtitle: 'Create new entry', icon: <Plus size={16} />, category: 'action' as const, action: () => { /* Handled by FAB */ onClose(); } },
      { id: 'settings', title: 'Settings', subtitle: 'App configuration', icon: <Settings size={16} />, category: 'setting' as const, action: () => { navigate('/settings'); onClose(); } },
      { id: 'insights', title: 'Insights', subtitle: 'View analytics', icon: <TrendingUp size={16} />, category: 'setting' as const, action: () => { navigate('/insights'); onClose(); } },
    ];

    actions.forEach((a) => {
      if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return;
      results.push({ ...a, icon: a.icon } as CommandItem);
    });

    return results.slice(0, 10);
  }, [data, search, navigate, onClose]);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <Search size={20} className="text-gray-400 mr-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions, accounts, or actions..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
            autoFocus
          />
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
              No results found
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                onClick={item.action}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  {item.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.title}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{item.subtitle}</div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer Hint */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 flex justify-between">
          <span>Press <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">Ctrl+K</kbd> to toggle</span>
          <span>{items.length} results</span>
        </div>
      </div>
    </div>
  );
}
