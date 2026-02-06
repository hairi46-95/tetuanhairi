
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Service, ClientRecord, CartItem, PaymentMethod, BluetoothState, PrinterSettings } from './types';
import { INITIAL_SERVICES, PRINTER_SERVICE_UUID, PRINTER_CHARACTERISTIC_UUID } from './constants';
import { analyzeLegalServices, generateLegalAdvice } from './services/geminiService';
import { 
  ESC_INIT, ESC_ALIGN_CENTER, ESC_ALIGN_LEFT, 
  ESC_BOLD_ON, ESC_BOLD_OFF, ESC_FEED, 
  FONT_SIZE_NORMAL, FONT_SIZE_LARGE, FONT_SIZE_DOUBLE_HEIGHT,
  textToBytes, sendDataToPrinter, getSeparator 
} from './utils/bluetoothUtils';

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  paperWidth: '58mm',
  fontSize: 'Normal',
  extraFeeds: 3,
  boldHeaders: true,
  footerText: 'Terima Kasih atas urusan anda.',
  googleSheetUrl: '',
  googleAppsScriptUrl: 'https://script.google.com/macros/s/AKfycbyIHqNj2twPWG1vvrHOhe4v2nkWtCQF6TvStKCBDv2CyoTLeT_FuQvGVOvhWuEVlDAr/exec',
  autoSaveInterval: 60,
  autoSync: false,
  includePhone: true,
  includeAddress: true
};

const HMLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 500 350" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M50,100 L120,100 L120,180 L180,180 L180,100 L250,100 L250,300 L180,300 L180,230 L120,230 L120,300 L50,300 Z" fill="#ffae00" stroke="black" strokeWidth="10"/>
    <path d="M260,100 L320,100 L350,180 L380,100 L440,100 L440,300 L380,300 L380,160 L350,240 L320,160 L320,300 L260,300 Z" fill="#ffae00" stroke="black" strokeWidth="10"/>
    <path d="M250,140 A150,120 0 1,1 150,320" fill="none" stroke="#6b7280" strokeWidth="25" strokeLinecap="round"/>
    <path d="M250,140 A150,120 0 0,0 350,20" fill="none" stroke="#ffae00" strokeWidth="25" strokeLinecap="round"/>
  </svg>
);

// Utility for date formatting
const getTodayISO = () => new Date().toISOString().split('T')[0];
const formatDateForDisplay = (isoDate: string) => {
  if (!isoDate) return '-';
  // If already in display format, return it
  if (isoDate.includes('/')) return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};
const formatDateForInput = (displayDate: string) => {
  if (!displayDate) return getTodayISO();
  // If displayDate is DD/MM/YYYY
  if (displayDate.includes('/')) {
    const [d, m, y] = displayDate.split('/');
    return `${y}-${m}-${d}`;
  }
  return displayDate; // Already in ISO format
};

const App: React.FC = () => {
  // --- State ---
  const [services, setServices] = useState<Service[]>(() => {
    const saved = localStorage.getItem('hm_services');
    return saved ? JSON.parse(saved) : INITIAL_SERVICES;
  });
  
  const [clients, setClients] = useState<ClientRecord[]>(() => {
    const saved = localStorage.getItem('hm_clients');
    return saved ? JSON.parse(saved) : [];
  });

  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(() => {
    const saved = localStorage.getItem('hm_printer_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_PRINTER_SETTINGS, ...parsed };
    }
    return DEFAULT_PRINTER_SETTINGS;
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPrintConfirmOpen, setIsPrintConfirmOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientForm, setClientForm] = useState({
    date: getTodayISO(),
    name: '',
    phone: '',
    address: '',
    payment: PaymentMethod.TUNAI
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [newService, setNewService] = useState({ name: '', price: '' });
  const [editId, setEditId] = useState<string | null>(null);
  
  // AI related states
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isTipsLoading, setIsTipsLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [legalTips, setLegalTips] = useState<string[]>([]);
  const [isTipsModalOpen, setIsTipsModalOpen] = useState(false);
  
  // Sync related states
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncStatus, setLastSyncStatus] = useState<'success' | 'error' | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(localStorage.getItem('hm_last_sync_time'));
  
  const [isAutoSaveNotifying, setIsAutoSaveNotifying] = useState(false);
  
  const [bt, setBt] = useState<BluetoothState>({
    device: null,
    characteristic: null,
    status: 'Bluetooth: Tidak Bersambung (Klik Cari Device)',
    connected: false
  });

  // --- Derived State ---
  const filteredServices = useMemo(() => {
    return services.filter(s => 
      s.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [services, searchTerm]);

  const total = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.price, 0);
  }, [cart]);

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem('hm_services', JSON.stringify(services));
  }, [services]);

  useEffect(() => {
    localStorage.setItem('hm_clients', JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem('hm_printer_settings', JSON.stringify(printerSettings));
  }, [printerSettings]);

  useEffect(() => {
    const draft = localStorage.getItem('hm_order_draft');
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        setClientForm(parsed.clientForm);
        setCart(parsed.cart);
        setEditId(parsed.editId);
      } catch (e) {
        console.error("Failed to load draft", e);
      }
    }
  }, []);

  useEffect(() => {
    const intervalTime = Math.max(5, printerSettings.autoSaveInterval || 60) * 1000;
    const interval = setInterval(() => {
      const draft = { clientForm, cart, editId };
      localStorage.setItem('hm_order_draft', JSON.stringify(draft));
      
      // Visual notification for auto-save
      setIsAutoSaveNotifying(true);
      setTimeout(() => setIsAutoSaveNotifying(false), 2500);
    }, intervalTime);

    return () => clearInterval(interval);
  }, [clientForm, cart, editId, printerSettings.autoSaveInterval]);

  // --- Actions ---
  const handleAddService = () => {
    if (!newService.name || !newService.price) return;
    const item: Service = {
      id: Date.now().toString(),
      name: newService.name.toUpperCase(),
      price: parseFloat(newService.price)
    };
    setServices([item, ...services]);
    setNewService({ name: '', price: '' });
  };

  const handleDeleteService = (id: string) => {
    if (window.confirm("Padam servis ini dari senarai kekal?")) {
      setServices(services.filter(s => s.id !== id));
    }
  };

  const addToCart = (service: Service) => {
    setCart([...cart, { ...service, id: Date.now().toString() }]);
  };

  const removeFromCart = (id: string) => {
    setCart(cart.filter(c => c.id !== id));
  };

  const resetForm = () => {
    setClientForm({ 
      date: getTodayISO(),
      name: '', 
      phone: '', 
      address: '', 
      payment: PaymentMethod.TUNAI 
    });
    setCart([]);
    setEditId(null);
    setAiSummary('');
    setLegalTips([]);
    localStorage.removeItem('hm_order_draft');
  };

  const syncToGoogleSheet = async (isAuto = false) => {
    if (!printerSettings.googleAppsScriptUrl) {
      if (!isAuto) alert("Sila masukkan URL Apps Script dalam tetapan.");
      return;
    }
    if (clients.length === 0) {
      if (!isAuto) alert("Tiada data rekod untuk disegerakkan.");
      return;
    }
    
    setIsSyncing(true);
    setLastSyncStatus(null);
    
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        isAutoSync: isAuto,
        data: clients.map(c => ({
          date: c.date,
          name: c.name,
          phone: c.phone,
          address: c.address,
          items: c.items,
          total: c.total,
          payment: c.payment
        }))
      };

      await fetch(printerSettings.googleAppsScriptUrl, { 
        method: 'POST', 
        mode: 'no-cors', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload) 
      });
      
      const now = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });
      setLastSyncedAt(now);
      localStorage.setItem('hm_last_sync_time', now);
      setLastSyncStatus('success');
      setTimeout(() => setLastSyncStatus(null), 5000);
      if (!isAuto) alert("Penyegerakan berjaya dihantar ke Google Sheets.");
    } catch (error) {
      console.error("Sync Error:", error);
      setLastSyncStatus('error');
      if (!isAuto) alert("Gagal menyegerakkan data. Sila semak URL Apps Script anda.");
    } finally {
      setIsSyncing(false);
    }
  };

  const saveRecord = () => {
    if (!clientForm.name) return alert("Sila masukkan nama pelanggan");
    if (cart.length === 0) return alert("Sila pilih sekurang-kurangnya satu servis");

    const record: ClientRecord = {
      id: editId || Date.now().toString(),
      date: formatDateForDisplay(clientForm.date),
      name: clientForm.name,
      phone: clientForm.phone,
      address: clientForm.address,
      items: cart.map(i => i.name).join(', '),
      total,
      payment: clientForm.payment,
      cartItems: [...cart]
    };

    let updatedClients;
    if (editId) {
      updatedClients = clients.map(c => c.id === editId ? record : c);
      alert("Rekod berjaya dikemaskini.");
    } else {
      updatedClients = [record, ...clients];
      alert("Rekod baru berjaya disimpan.");
    }
    
    setClients(updatedClients);
    resetForm();

    if (printerSettings.autoSync) {
      setTimeout(() => syncToGoogleSheet(true), 500);
    }
  };

  const editClient = (record: ClientRecord) => {
    setEditId(record.id);
    setClientForm({
      date: formatDateForInput(record.date),
      name: record.name,
      phone: record.phone,
      address: record.address,
      payment: record.payment as PaymentMethod
    });
    setCart(record.cartItems || []);
    
    // Smooth scroll to order section
    const orderSection = document.getElementById('order');
    if (orderSection) {
      const yOffset = -100; 
      const y = orderSection.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  const deleteClient = (id: string) => {
    if (window.confirm("Padam rekod ini secara kekal?")) {
      setClients(clients.filter(c => c.id !== id));
      if (editId === id) resetForm();
    }
  };

  const connectBluetooth = async () => {
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: [PRINTER_SERVICE_UUID] }],
        optionalServices: [PRINTER_SERVICE_UUID]
      });
      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService(PRINTER_SERVICE_UUID);
      const characteristic = await service?.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);
      if (characteristic) {
        setBt({ device, characteristic, status: `Bluetooth: BERSAMBUNG (${device.name})`, connected: true });
        device.addEventListener('gattserverdisconnected', () => {
          setBt({ device: null, characteristic: null, status: 'Bluetooth: Terputus', connected: false });
        });
      }
    } catch (error) {
      alert("Gagal menyambung Bluetooth. Pastikan Bluetooth dihidupkan.");
    }
  };

  const handleBluetoothPrintTrigger = () => {
    if (!bt.characteristic) return alert("Sila sambung Bluetooth dahulu");
    if (!clientForm.name) return alert("Sila isi maklumat pelanggan");
    if (cart.length === 0) return alert("Sila pilih servis");
    setIsPrintConfirmOpen(true);
  };

  const printBluetoothDirect = async (isTest: boolean = false) => {
    if (!bt.characteristic) return alert("Sila sambung Bluetooth dahulu");
    try {
      const char = bt.characteristic;
      const sep = getSeparator(printerSettings.paperWidth);
      await sendDataToPrinter(char, ESC_INIT);
      await sendDataToPrinter(char, ESC_ALIGN_CENTER);
      if (printerSettings.boldHeaders) await sendDataToPrinter(char, ESC_BOLD_ON);
      await sendDataToPrinter(char, FONT_SIZE_LARGE);
      await sendDataToPrinter(char, textToBytes("HAIRI MUSTAFA ASSOCIATES"));
      await sendDataToPrinter(char, FONT_SIZE_NORMAL);
      if (printerSettings.boldHeaders) await sendDataToPrinter(char, ESC_BOLD_OFF);
      await sendDataToPrinter(char, textToBytes("Peguam Syarie & PJS"));
      await sendDataToPrinter(char, textToBytes("011-5653 1310"));
      await sendDataToPrinter(char, textToBytes(sep));
      await sendDataToPrinter(char, ESC_ALIGN_LEFT);
      await sendDataToPrinter(char, textToBytes(`Tarikh: ${formatDateForDisplay(clientForm.date)}`));
      await sendDataToPrinter(char, textToBytes(`Nama: ${isTest ? 'TEST PRINT' : clientForm.name}`));
      
      // Conditionally include phone and address on Bluetooth receipt
      if (!isTest && printerSettings.includePhone && clientForm.phone) {
        await sendDataToPrinter(char, textToBytes(`Tel: ${clientForm.phone}`));
      }
      if (!isTest && printerSettings.includeAddress && clientForm.address) {
        await sendDataToPrinter(char, textToBytes(`Alamat: ${clientForm.address}`));
      }

      await sendDataToPrinter(char, textToBytes(sep));
      if (isTest) {
        await sendDataToPrinter(char, textToBytes("TEST SERVICE"));
        await sendDataToPrinter(char, textToBytes("RM 10.00"));
      } else {
        for (const item of cart) {
          await sendDataToPrinter(char, textToBytes(`${item.name}`));
          await sendDataToPrinter(char, textToBytes(`RM ${item.price.toFixed(2)}`));
        }
      }
      await sendDataToPrinter(char, textToBytes(sep));
      await sendDataToPrinter(char, ESC_ALIGN_CENTER);
      await sendDataToPrinter(char, ESC_BOLD_ON);
      await sendDataToPrinter(char, FONT_SIZE_DOUBLE_HEIGHT);
      await sendDataToPrinter(char, textToBytes(`JUMLAH: RM ${isTest ? '10.00' : total.toFixed(2)}`));
      await sendDataToPrinter(char, FONT_SIZE_NORMAL);
      await sendDataToPrinter(char, ESC_BOLD_OFF);
      await sendDataToPrinter(char, textToBytes(printerSettings.footerText || "Terima Kasih"));
      for (let i = 0; i < printerSettings.extraFeeds; i++) await sendDataToPrinter(char, ESC_FEED);
    } catch (e) {
      alert("Ralat cetakan Bluetooth: " + e);
    } finally {
      setIsPrintConfirmOpen(false);
    }
  };

  const handleAiAnalyze = async () => {
    if (cart.length === 0) return;
    setIsAiLoading(true);
    const summary = await analyzeLegalServices(cart.map(c => c.name), `Pelanggan: ${clientForm.name}`);
    setAiSummary(summary || '');
    setIsAiLoading(false);
  };

  const handleGenerateTips = async () => {
    if (cart.length === 0) return alert("Pilih sekurang-kurangnya satu servis untuk menjana tips.");
    setIsTipsLoading(true);
    try {
      const advice = await generateLegalAdvice(cart.map(c => c.name));
      if (advice && advice.tips && advice.tips.length > 0) {
        setLegalTips(advice.tips);
        setIsTipsModalOpen(true);
      } else {
        alert("AI tidak dapat menjana tips buat masa ini.");
      }
    } catch (e) {
      alert("Ralat semasa menjana tips.");
    } finally {
      setIsTipsLoading(false);
    }
  };

  const handlePrint = (type: 'a5' | 'thermal') => {
    if (!clientForm.name) return alert("Sila isi maklumat pelanggan");
    document.body.classList.add(`printing-${type}`);
    window.print();
    setTimeout(() => document.body.classList.remove(`printing-${type}`), 500);
  };

  const exportCSV = () => {
    const headers = ["Tarikh", "Nama", "Telefon", "Alamat", "Servis", "Jumlah", "Bayaran"];
    const rows = clients.map(c => [
      c.date, 
      `"${c.name.replace(/"/g, '""')}"`, 
      c.phone || '-', 
      `"${(c.address || '').replace(/"/g, '""')}"`, 
      `"${c.items.replace(/"/g, '""')}"`, 
      c.total.toFixed(2), 
      c.payment
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `HM_Records_${new Date().getTime()}.csv`;
    link.click();
  };

  const openGoogleSheet = () => {
    if (!printerSettings.googleSheetUrl) return alert("Sila masukkan URL Google Sheet dalam tetapan.");
    window.open(printerSettings.googleSheetUrl, '_blank');
  };

  const sendWa = () => {
    const msg = `*RESIK RASMI: HAIRI MUSTAFA ASSOCIATES*%0a------------------------%0aNama: ${clientForm.name}%0aTarikh: ${formatDateForDisplay(clientForm.date)}%0aJumlah Bayaran: RM ${total.toFixed(2)}%0aServis: ${cart.map(i => i.name).join(', ')}%0a------------------------%0aTerima kasih.`;
    window.open(`https://wa.me/601156531310?text=${msg}`, '_blank');
  };

  const resetSettings = () => {
    if (window.confirm("Tetapkan semula konfigurasi ke asal?")) setPrinterSettings(DEFAULT_PRINTER_SETTINGS);
  };

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 w-full bg-black/95 border-b-2 border-law-gold z-50 flex justify-between items-center px-6 py-4 shadow-lg shadow-black/50">
        <div className="text-lg md:text-xl font-bold font-cinzel bg-gradient-to-r from-law-red via-law-orange to-law-yellow bg-clip-text text-transparent">
          HAIRI MUSTAFA ASSOCIATES
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-6">
            <a href="#services" className="text-law-gold hover:text-white transition-colors text-sm uppercase tracking-wider">Perkhidmatan</a>
            <a href="#order" className="text-law-gold hover:text-white transition-colors text-sm uppercase tracking-wider">Tempahan</a>
            <a href="#records" className="text-law-gold hover:text-white transition-colors text-sm uppercase tracking-wider">Rekod</a>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="text-law-gold hover:text-white transition-all p-2 hover:scale-110 active:scale-95">
            <i className="fas fa-cog text-xl"></i>
          </button>
        </div>
      </nav>

      {/* Auto-save notification pill */}
      <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[60] bg-law-gold/90 text-black px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 shadow-xl border border-law-yellow transition-all duration-500 transform ${isAutoSaveNotifying ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
        <i className="fas fa-check-circle"></i>
        <span>Draft Disimpan Automatik</span>
      </div>

      <main className="container mx-auto px-4 pt-24 pb-12 space-y-12">
        {/* Services Section */}
        <section id="services" className="space-y-6">
          <div className="flex justify-between items-end border-b border-gray-800 pb-2">
            <h2 className="text-2xl font-cinzel text-law-gold">Senarai Perkhidmatan</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">Pilih servis untuk ditambah ke bakul</p>
          </div>
          
          <div className="bg-gray-900/50 border border-dashed border-law-gold/30 p-5 rounded-xl flex flex-wrap gap-3 items-center shadow-inner">
            <div className="flex-1 min-w-[200px] space-y-1">
              <label className="text-[9px] text-law-gold font-bold uppercase ml-1">Nama Servis</label>
              <input className="w-full bg-black border border-gray-700 p-2.5 rounded text-sm outline-none focus:border-law-gold transition-colors" placeholder="Contoh: AFIDAVIT BARU" value={newService.name} onChange={(e) => setNewService({ ...newService, name: e.target.value })} />
            </div>
            <div className="w-32 space-y-1">
              <label className="text-[9px] text-law-gold font-bold uppercase ml-1">Harga (RM)</label>
              <input type="number" className="w-full bg-black border border-gray-700 p-2.5 rounded text-sm outline-none focus:border-law-gold transition-colors" placeholder="0.00" value={newService.price} onChange={(e) => setNewService({ ...newService, price: e.target.value })} />
            </div>
            <button onClick={handleAddService} className="mt-5 bg-law-gold text-black font-bold px-8 py-2.5 rounded hover:bg-law-yellow transition-all active:scale-95 shadow-lg shadow-law-gold/10">TAMBAH</button>
          </div>

          <div className="relative group">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-law-gold group-focus-within:text-law-yellow transition-colors"></i>
            <input className="w-full bg-gray-900/80 border border-law-gold/20 pl-12 pr-4 py-4 rounded-xl outline-none focus:border-law-gold focus:ring-1 focus:ring-law-gold/30 transition-all text-sm" placeholder="Cari perkhidmatan dalam pangkalan data..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredServices.map((s) => (
              <div key={s.id} className="bg-law-card border border-gray-800 p-5 rounded-xl flex flex-col justify-between hover:border-law-gold transition-all group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-law-gold opacity-30 group-hover:opacity-100 transition-opacity"></div>
                <div className="flex justify-between items-start mb-4">
                  <h4 className="text-sm font-bold uppercase text-gray-100 pr-2 leading-tight tracking-tight">{s.name}</h4>
                  <button onClick={() => handleDeleteService(s.id)} className="text-gray-700 hover:text-law-red transition-colors opacity-0 group-hover:opacity-100 p-1"><i className="fas fa-trash text-[10px]"></i></button>
                </div>
                <div className="flex justify-between items-center mt-auto border-t border-gray-800/50 pt-4">
                  <div className="text-law-gold font-bold text-lg">RM {s.price.toFixed(2)}</div>
                  <button onClick={() => addToCart(s)} className="p-2.5 px-4 border border-law-gold/50 text-law-gold rounded-lg hover:bg-law-gold hover:text-black transition-all active:scale-90 flex items-center gap-2">
                    <i className="fas fa-cart-plus"></i>
                    <span className="text-[10px] font-bold">PILIH</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Order Section */}
        <section id="order" className={`grid grid-cols-1 lg:grid-cols-2 gap-8 p-6 md:p-10 rounded-2xl border transition-all duration-500 ${editId ? 'bg-indigo-900/10 border-indigo-500/50 shadow-2xl shadow-indigo-500/10' : 'bg-gray-900/20 border-gray-800'}`}>
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <div>
                <h3 className={`font-cinzel text-2xl transition-colors ${editId ? 'text-indigo-400' : 'text-law-orange'}`}>
                  {editId ? 'Kemaskini Rekod' : 'Maklumat Pelanggan'}
                </h3>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Sila isi butiran lengkap pelanggan</p>
              </div>
              {editId && (
                <div className="flex flex-col items-end gap-1">
                  <span className="bg-indigo-600 text-white text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-widest animate-pulse flex items-center gap-2">
                    <i className="fas fa-edit"></i>
                    Mod Mengemaskini
                  </span>
                  <button onClick={resetForm} className="text-[9px] text-indigo-400 hover:text-indigo-200 uppercase font-bold tracking-tighter transition-colors">Batal & Buat Baru</button>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="relative md:col-span-2">
                <label className={`text-[10px] uppercase font-bold absolute -top-2 left-3 bg-law-bg px-1 z-10 ${editId ? 'text-indigo-400' : 'text-law-gold'}`}>Tarikh Urusan (DD/MM/YYYY)</label>
                <input 
                  type="date" 
                  className={`w-full bg-black border p-4 rounded-xl outline-none transition-all ${editId ? 'border-indigo-500/50 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30' : 'border-gray-700 focus:border-law-gold focus:ring-1 focus:ring-law-gold/30'}`}
                  value={clientForm.date} 
                  onChange={(e) => setClientForm({ ...clientForm, date: e.target.value })} 
                />
              </div>
              <div className="relative md:col-span-2">
                <label className={`text-[10px] uppercase font-bold absolute -top-2 left-3 bg-law-bg px-1 z-10 ${editId ? 'text-indigo-400' : 'text-law-gold'}`}>Nama Penuh Pelanggan</label>
                <input className={`w-full bg-black border p-4 rounded-xl outline-none transition-all ${editId ? 'border-indigo-500/50 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30' : 'border-gray-700 focus:border-law-gold focus:ring-1 focus:ring-law-gold/30'}`} placeholder="Nama Pelanggan" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} />
              </div>
              <div className="relative">
                <label className={`text-[10px] uppercase font-bold absolute -top-2 left-3 bg-law-bg px-1 z-10 ${editId ? 'text-indigo-400' : 'text-law-gold'}`}>No. Telefon</label>
                <input type="tel" className={`w-full bg-black border p-4 rounded-xl outline-none transition-all ${editId ? 'border-indigo-500/50 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30' : 'border-gray-700 focus:border-law-gold focus:ring-1 focus:ring-law-gold/30'}`} placeholder="01X-XXXXXXX" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} />
              </div>
              <div className="relative">
                <label className={`text-[10px] uppercase font-bold absolute -top-2 left-3 bg-law-bg px-1 z-10 ${editId ? 'text-indigo-400' : 'text-law-gold'}`}>Kaedah Bayaran</label>
                <select className={`w-full bg-black border p-4 rounded-xl outline-none transition-all ${editId ? 'border-indigo-500/50 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30' : 'border-gray-700 focus:border-law-gold focus:ring-1 focus:ring-law-gold/30'}`} value={clientForm.payment} onChange={(e) => setClientForm({ ...clientForm, payment: e.target.value as PaymentMethod })}>
                  <option value={PaymentMethod.TUNAI}>Tunai</option>
                  <option value={PaymentMethod.ONLINE}>Online Transfer</option>
                  <option value={PaymentMethod.QR}>DuitNow QR</option>
                </select>
              </div>
              <div className="relative md:col-span-2">
                <label className={`text-[10px] uppercase font-bold absolute -top-2 left-3 bg-law-bg px-1 z-10 ${editId ? 'text-indigo-400' : 'text-law-gold'}`}>Alamat Penuh (Opsyenal)</label>
                <textarea rows={3} className={`w-full bg-black border p-4 rounded-xl outline-none transition-all ${editId ? 'border-indigo-500/50 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30' : 'border-gray-700 focus:border-law-gold focus:ring-1 focus:ring-law-gold/30'}`} placeholder="Alamat pelanggan..." value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })} />
              </div>
            </div>

            {/* AI Assistant Section */}
            <div className={`bg-black/40 border p-6 rounded-2xl space-y-5 shadow-2xl transition-all ${editId ? 'border-indigo-500/30' : 'border-law-gold/10'}`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="bg-law-gold/10 p-2 rounded-lg">
                    <i className="fas fa-robot text-law-gold"></i>
                  </div>
                  <div>
                    <h4 className="text-law-gold text-xs font-bold uppercase tracking-widest">Pembantu AI</h4>
                    <p className="text-[9px] text-gray-500">Analisis Prosedur & Tips</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={handleGenerateTips}
                    disabled={isTipsLoading || cart.length === 0}
                    className="group relative flex items-center gap-2 overflow-hidden rounded-lg bg-law-orange px-4 py-2 text-[10px] font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    {isTipsLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-lightbulb"></i>}
                    <span>Tips</span>
                  </button>
                  <button 
                    onClick={handleAiAnalyze}
                    disabled={isAiLoading || cart.length === 0}
                    className="group relative flex items-center gap-2 overflow-hidden rounded-lg bg-law-gold px-4 py-2 text-[10px] font-bold text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    {isAiLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-wand-magic-sparkles"></i>}
                    <span>Analisis</span>
                  </button>
                </div>
              </div>
              {aiSummary && (
                <div className="animate-fade-in bg-law-gold/5 border-l-4 border-law-gold p-4 rounded-r-xl">
                  <p className="text-sm text-gray-300 italic leading-relaxed">"{aiSummary}"</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-law-card p-8 rounded-2xl border border-gray-800 shadow-3xl flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-law-gold/5 blur-3xl -mr-16 -mt-16"></div>
            
            <div className="flex justify-between items-center border-b border-gray-800 pb-4 mb-6">
              <h3 className="text-law-gold font-cinzel text-xl">Butiran Tempahan</h3>
            </div>

            <div className="flex-1 space-y-3 max-h-[350px] overflow-y-auto mb-8 pr-2 custom-scrollbar">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between items-center bg-black/40 p-4 rounded-xl border border-gray-800/50 group hover:border-law-gold/30 transition-all shadow-sm">
                  <div className="space-y-0.5">
                    <span className="text-xs text-gray-100 font-bold uppercase block">{item.name}</span>
                    <span className="text-[10px] text-gray-500">Kuantiti: 1</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-law-gold font-bold">RM {item.price.toFixed(2)}</span>
                    <button onClick={() => removeFromCart(item.id)} className="text-gray-600 hover:text-law-red transition-colors p-1"><i className="fas fa-times-circle"></i></button>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 opacity-30">
                  <i className="fas fa-shopping-basket text-4xl mb-4"></i>
                  <p className="text-center text-sm italic">Sila pilih perkhidmatan dari senarai di atas.</p>
                </div>
              )}
            </div>

            <div className="border-t border-gray-800 pt-6 space-y-6">
              <div className="flex justify-between items-end">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-[0.2em]">Jumlah Keseluruhan</span>
                <div className="text-4xl font-cinzel text-law-gold drop-shadow-lg">RM {total.toFixed(2)}</div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onClick={connectBluetooth} className="col-span-2 md:col-span-4 bg-gray-800/80 p-3 rounded-xl font-bold text-xs hover:bg-gray-700 transition-all border border-gray-700 flex items-center justify-center gap-3 uppercase tracking-widest active:scale-95">
                  <i className="fab fa-bluetooth-b"></i> 
                  <span>{bt.connected ? 'SAMBUNGAN AKTIF' : 'SAMBUNG PRINTER BT'}</span>
                </button>
                
                <button onClick={handleBluetoothPrintTrigger} className="bg-blue-600/90 p-3 rounded-xl text-[10px] font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20 uppercase active:scale-95">BT PRINT</button>
                <button onClick={sendWa} className="bg-green-600/90 p-3 rounded-xl text-[10px] font-bold hover:bg-green-500 transition-all shadow-lg shadow-green-900/20 uppercase active:scale-95">WHATSAPP</button>
                <button onClick={() => handlePrint('thermal')} className="bg-sky-600/90 p-3 rounded-xl text-[10px] font-bold hover:bg-sky-500 transition-all shadow-lg shadow-sky-900/20 uppercase active:scale-95">THERMAL PC</button>
                <button onClick={() => handlePrint('a5')} className="bg-white text-black p-3 rounded-xl text-[10px] font-bold hover:bg-gray-200 transition-all shadow-lg shadow-white/10 uppercase active:scale-95">RESIT A5</button>
                
                <div className="col-span-2 md:col-span-4 mt-2">
                  {editId ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={saveRecord} className="bg-indigo-600 text-white p-5 rounded-xl font-black text-xs hover:bg-indigo-500 shadow-xl shadow-indigo-900/20 active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center gap-3">
                        <i className="fas fa-save"></i> KEMASKINI REKOD
                      </button>
                      <button onClick={resetForm} className="bg-gray-800 text-gray-300 p-5 rounded-xl font-bold text-xs hover:bg-gray-700 active:scale-95 transition-all uppercase tracking-widest border border-gray-700">BATAL</button>
                    </div>
                  ) : (
                    <button onClick={saveRecord} className="w-full bg-law-gold text-black p-5 rounded-xl font-black text-xs hover:brightness-110 shadow-xl shadow-law-gold/20 active:scale-95 transition-all uppercase tracking-[0.2em] flex items-center justify-center gap-3">
                      <i className="fas fa-check-double"></i> SIMPAN REKOD BARU
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Records Table Section */}
        <section id="records" className="space-y-6">
          <div className="flex flex-col md:flex-row md:justify-between md:items-end border-b border-gray-800 pb-3 gap-6">
            <div>
              <h2 className="text-3xl font-cinzel text-law-gold">Pangkalan Data Rekod</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Urus semua transaksi pejabat peguam di sini</p>
            </div>
            
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={openGoogleSheet} className="bg-green-700/10 text-green-400 border border-green-700/30 text-[10px] px-4 py-2.5 rounded-lg font-bold hover:bg-green-700/20 transition-all flex items-center gap-2">
                <i className="fas fa-external-link-alt"></i>
                BUKA SHEET
              </button>
              
              <div className="flex flex-col items-end gap-1">
                <button onClick={() => syncToGoogleSheet(false)} disabled={isSyncing} className={`text-[10px] px-4 py-2.5 rounded-lg font-bold transition-all flex items-center gap-2 border ${isSyncing ? 'bg-blue-700/50 text-blue-100 border-blue-400/50 animate-pulse' : lastSyncStatus === 'success' ? 'bg-green-700/20 text-green-400 border-green-500/50' : 'bg-blue-700/10 text-blue-400 border-blue-700/30 hover:bg-blue-700/20'}`}>
                  {isSyncing ? <i className="fas fa-sync fa-spin"></i> : lastSyncStatus === 'success' ? <i className="fas fa-check-circle"></i> : <i className="fas fa-cloud-upload-alt"></i>}
                  {isSyncing ? 'SEDANG SEGERAK...' : lastSyncStatus === 'success' ? 'BERJAYA!' : 'CLOUD SYNC'}
                </button>
                {lastSyncedAt && <span className="text-[8px] text-gray-600 font-bold uppercase tracking-widest">KEMASAN: {lastSyncedAt}</span>}
              </div>

              <button onClick={exportCSV} className="bg-teal-700/10 text-teal-400 border border-teal-700/30 text-[10px] px-4 py-2.5 rounded-lg font-bold hover:bg-teal-700/20 transition-all flex items-center gap-2">
                <i className="fas fa-file-csv"></i>
                EKSPORT CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-law-card/50 shadow-inner backdrop-blur-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-900/80 text-law-gold uppercase tracking-widest font-bold sticky top-0 z-10">
                <tr>
                  <th className="p-5 border-b border-gray-800">AKSI</th>
                  <th className="p-5 border-b border-gray-800">TARIKH</th>
                  <th className="p-5 border-b border-gray-800">PELANGGAN</th>
                  <th className="p-5 border-b border-gray-800">TOTAL</th>
                  <th className="p-5 border-b border-gray-800">KAEDAH</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {clients.map((c) => (
                  <tr 
                    key={c.id} 
                    className={`transition-all duration-300 group ${editId === c.id ? 'bg-indigo-900/40 ring-2 ring-inset ring-indigo-500/50 z-10' : 'hover:bg-white/5'}`}
                  >
                    <td className="p-5">
                      <div className="flex gap-4">
                        <button 
                          onClick={() => editClient(c)} 
                          className={`transition-all hover:scale-125 ${editId === c.id ? 'text-indigo-400 animate-pulse' : 'text-gray-500 hover:text-law-gold'}`} 
                          title="Kemaskini Rekod"
                        >
                          <i className={`fas ${editId === c.id ? 'fa-spinner fa-spin' : 'fa-edit'} text-lg`}></i>
                        </button>
                        <button 
                          onClick={() => deleteClient(c.id)} 
                          className="text-gray-500 hover:text-law-red transition-all hover:scale-125" 
                          title="Padam Rekod"
                        >
                          <i className="fas fa-trash-alt text-lg"></i>
                        </button>
                      </div>
                    </td>
                    <td className={`p-5 tabular-nums ${editId === c.id ? 'text-indigo-200 font-bold' : 'text-gray-400'}`}>
                      {c.date}
                    </td>
                    <td className="p-5">
                      <div className="flex flex-col">
                        <span className={`font-bold text-sm tracking-tight ${editId === c.id ? 'text-indigo-50' : 'text-gray-100'}`}>{c.name}</span>
                        <span className="text-[10px] text-gray-500 truncate max-w-[200px] mt-1 group-hover:text-gray-400 transition-colors">{c.items}</span>
                      </div>
                    </td>
                    <td className={`p-5 text-sm font-bold tabular-nums ${editId === c.id ? 'text-white underline decoration-indigo-500 underline-offset-4' : 'text-law-gold'}`}>
                      RM {c.total.toFixed(2)}
                    </td>
                    <td className="p-5">
                      <span className={`inline-block px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest ${editId === c.id ? 'bg-indigo-500/30 text-indigo-100 border border-indigo-500/50' : 'bg-gray-800/50 text-gray-400 border border-gray-700/50'}`}>
                        {c.payment}
                      </span>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-16 text-center">
                      <div className="flex flex-col items-center opacity-20">
                        <i className="fas fa-database text-6xl mb-4"></i>
                        <p className="text-xl font-cinzel italic tracking-widest">Tiada rekod tersimpan di dalam pangkalan data</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Bluetooth Print Confirmation Modal */}
      {isPrintConfirmOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-law-card border border-law-gold w-full max-w-sm rounded-2xl overflow-hidden shadow-3xl flex flex-col transform transition-transform animate-scale-up">
            <div className="bg-law-bg p-6 text-center space-y-4">
              <div className="bg-law-gold/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2 border border-law-gold/20">
                <i className="fas fa-print text-law-gold text-2xl"></i>
              </div>
              <h3 className="text-law-gold font-cinzel text-lg tracking-widest">SAHKAN CETAKAN</h3>
              <p className="text-gray-400 text-sm">Adakah anda pasti untuk mencetak resit Bluetooth ini?</p>
              
              <div className="bg-black/50 p-4 rounded-xl border border-gray-800 space-y-1">
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Jumlah Perlu Dibayar</p>
                <p className="text-3xl font-cinzel text-law-gold">RM {total.toFixed(2)}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-4">
                <button 
                  onClick={() => setIsPrintConfirmOpen(false)}
                  className="bg-gray-800 text-gray-400 py-4 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-gray-700 transition-all border border-gray-700 active:scale-95"
                >
                  Batal
                </button>
                <button 
                  onClick={() => printBluetoothDirect(false)}
                  className="bg-law-gold text-black py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:brightness-110 shadow-lg shadow-law-gold/10 transition-all active:scale-95"
                >
                  Cetak Sekarang
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legal Tips Modal */}
      {isTipsModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-fade-in">
          <div className="bg-law-card border border-law-orange w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col transform transition-transform animate-scale-up">
            <div className="bg-law-orange p-6 border-b border-black/20 flex justify-between items-center shadow-lg">
              <h3 className="text-white font-cinzel text-lg tracking-widest flex items-center gap-3">
                <i className="fas fa-balance-scale"></i> PESANAN PEGUAM
              </h3>
              <button onClick={() => setIsTipsModalOpen(false)} className="text-white/80 hover:text-white transition-all bg-black/10 hover:bg-black/20 rounded-full w-9 h-9 flex items-center justify-center">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-8 space-y-6 bg-gradient-to-b from-gray-900 to-law-card">
              <div className="space-y-5">
                {legalTips.map((tip, idx) => (
                  <div key={idx} className="flex gap-5 items-start bg-black/40 p-5 rounded-2xl border border-law-orange/10 hover:border-law-orange/30 transition-all group shadow-inner">
                    <span className="bg-law-orange text-white w-8 h-8 flex items-center justify-center rounded-xl text-xs font-black flex-shrink-0 shadow-md group-hover:scale-110 transition-transform">{idx + 1}</span>
                    <p className="text-sm text-gray-200 leading-relaxed font-lato font-medium">{tip}</p>
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setIsTipsModalOpen(false)}
                className="w-full bg-law-orange text-white py-4 rounded-xl font-black hover:brightness-110 active:scale-[0.98] transition-all uppercase tracking-widest text-xs shadow-xl shadow-law-orange/20 border border-law-orange/30"
              >
                SAHAJA & TUTUP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-lg animate-fade-in">
          <div className="bg-law-card border border-law-gold/50 w-full max-w-xl rounded-3xl overflow-hidden shadow-3xl flex flex-col max-h-[85vh] transform transition-all animate-scale-up">
            <div className="bg-gray-900 p-6 border-b border-law-gold/20 flex justify-between items-center shadow-md">
              <div className="flex items-center gap-3">
                <i className="fas fa-user-shield text-law-gold text-2xl"></i>
                <h3 className="text-law-gold font-cinzel text-xl tracking-widest">PENGURUSAN SISTEM</h3>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="text-gray-500 hover:text-white transition-colors p-2"><i className="fas fa-times text-xl"></i></button>
            </div>
            
            <div className="p-8 space-y-10 overflow-y-auto custom-scrollbar bg-gradient-to-b from-transparent to-black/30">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <i className="fas fa-quote-left text-law-gold text-[10px]"></i>
                  <label className="text-xs text-law-gold uppercase font-black tracking-widest">Nota Kaki Resit Rasmi</label>
                </div>
                <textarea className="w-full bg-black border border-gray-800 p-4 rounded-xl text-sm text-gray-300 focus:border-law-gold focus:ring-1 focus:ring-law-gold/20 outline-none transition-all" rows={3} placeholder="Contoh: Dokumen ini dijana secara digital. Tiada tandatangan diperlukan." value={printerSettings.footerText} onChange={(e) => setPrinterSettings({ ...printerSettings, footerText: e.target.value })} />
              </div>

              {/* Printing Options */}
              <div className="space-y-4">
                <label className="text-xs text-law-gold uppercase font-black tracking-widest block mb-4">Pilihan Paparan Resit</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-4 bg-black p-4 rounded-xl border border-gray-800 hover:border-law-gold/20 transition-all group">
                    <input type="checkbox" id="includePhone" className="w-5 h-5 accent-law-gold cursor-pointer" checked={printerSettings.includePhone} onChange={(e) => setPrinterSettings({ ...printerSettings, includePhone: e.target.checked })} />
                    <label htmlFor="includePhone" className="text-xs text-gray-400 group-hover:text-gray-200 cursor-pointer select-none font-bold uppercase tracking-tighter">Paparkan No. Tel</label>
                  </div>
                  <div className="flex items-center gap-4 bg-black p-4 rounded-xl border border-gray-800 hover:border-law-gold/20 transition-all group">
                    <input type="checkbox" id="includeAddress" className="w-5 h-5 accent-law-gold cursor-pointer" checked={printerSettings.includeAddress} onChange={(e) => setPrinterSettings({ ...printerSettings, includeAddress: e.target.checked })} />
                    <label htmlFor="includeAddress" className="text-xs text-gray-400 group-hover:text-gray-200 cursor-pointer select-none font-bold uppercase tracking-tighter">Paparkan Alamat</label>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <i className="fas fa-history text-law-gold text-[10px]"></i>
                    <label className="text-xs text-law-gold uppercase font-black tracking-widest">Auto-Save (Saat)</label>
                  </div>
                  <input type="number" min="5" className="w-full bg-black border border-gray-800 p-4 rounded-xl text-sm text-gray-300 focus:border-law-gold outline-none transition-all" value={printerSettings.autoSaveInterval} onChange={(e) => setPrinterSettings({ ...printerSettings, autoSaveInterval: parseInt(e.target.value) || 60 })} />
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <i className="fas fa-sync-alt text-law-gold text-[10px]"></i>
                    <label className="text-xs text-law-gold uppercase font-black tracking-widest">Awan (Cloud)</label>
                  </div>
                  <div className="flex items-center gap-4 bg-black p-4 rounded-xl border border-gray-800 hover:border-law-gold/20 transition-all group">
                    <input type="checkbox" id="autoSync" className="w-5 h-5 accent-law-gold cursor-pointer" checked={printerSettings.autoSync} onChange={(e) => setPrinterSettings({ ...printerSettings, autoSync: e.target.checked })} />
                    <label htmlFor="autoSync" className="text-xs text-gray-400 group-hover:text-gray-200 cursor-pointer select-none font-bold uppercase tracking-tighter">Automatik Cloud Sync</label>
                  </div>
                </div>
              </div>

              <div className="space-y-6 pt-4 border-t border-gray-800/50">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <i className="fas fa-table text-law-gold text-[10px]"></i>
                    <label className="text-xs text-law-gold uppercase font-black tracking-widest">Pautan Google Sheet</label>
                  </div>
                  <input className="w-full bg-black border border-gray-800 p-4 rounded-xl text-sm text-gray-300 focus:border-law-gold outline-none" placeholder="https://docs.google.com/spreadsheets/d/..." value={printerSettings.googleSheetUrl} onChange={(e) => setPrinterSettings({ ...printerSettings, googleSheetUrl: e.target.value })} />
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <i className="fas fa-code text-law-gold text-[10px]"></i>
                    <label className="text-xs text-law-gold uppercase font-black tracking-widest">Google Apps Script API</label>
                  </div>
                  <input className="w-full bg-black border border-gray-800 p-4 rounded-xl text-sm text-gray-300 focus:border-law-gold outline-none" placeholder="https://script.google.com/macros/s/..." value={printerSettings.googleAppsScriptUrl} onChange={(e) => setPrinterSettings({ ...printerSettings, googleAppsScriptUrl: e.target.value })} />
                  <p className="text-[9px] text-gray-600 italic leading-relaxed">PENTING: Gunakan pautan 'Deployment' Apps Script anda untuk menyegerakkan data ke pangkalan data Google secara masa-nyata.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-6">
                <button onClick={resetSettings} className="bg-gray-900 text-gray-500 py-4 rounded-2xl font-black text-xs border border-gray-800 hover:text-white hover:border-gray-600 transition-all uppercase tracking-widest">Set Semula</button>
                <button onClick={() => setIsSettingsOpen(false)} className="bg-law-gold text-black py-4 rounded-2xl font-black text-xs hover:brightness-110 shadow-lg shadow-law-gold/10 transition-all uppercase tracking-widest">Tutup Tetapan</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Print Templates */}
      <div id="print-area-a5" className="hidden">
        <div className="flex flex-col items-center border-b-2 border-black pb-4 mb-6">
          <HMLogo className="w-24 h-24 mb-2" />
          <h1 className="text-2xl font-bold font-serif">HAIRI MUSTAFA ASSOCIATES</h1>
          <p className="text-sm">Peguam Syarie & Pesuruhjaya Sumpah</p>
          <p className="text-xs">Lot 02, Bangunan Arked Mara, 09100 Baling, Kedah. | Fon: 011-5653 1310</p>
        </div>
        <div className="flex justify-between mb-8 text-sm">
          <div>
            <strong>KEPADA:</strong><br />
            {clientForm.name}<br />
            {printerSettings.includePhone && clientForm.phone && <>{clientForm.phone}<br /></>}
            {printerSettings.includeAddress && clientForm.address && <>{clientForm.address}<br /></>}
          </div>
          <div className="text-right"><strong>TARIKH:</strong> {formatDateForDisplay(clientForm.date)}<br /><strong>BAYARAN:</strong> {clientForm.payment}</div>
        </div>
        <table className="w-full mb-8 text-sm">
          <thead className="border-b border-black"><tr><th className="text-left py-2">PERKARA</th><th className="text-right py-2">HARGA (RM)</th></tr></thead>
          <tbody>
            {cart.map((item, i) => (
              <tr key={i} className="border-b border-gray-200"><td className="py-2">{item.name}</td><td className="text-right py-2">{item.price.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="text-right text-xl font-bold">JUMLAH BESAR: RM {total.toFixed(2)}</div>
        <div className="mt-20 text-center text-[10px]"><p>{printerSettings.footerText}</p><p className="mt-1 opacity-50 italic">Dijana melalui LawFirmHM Pro System</p></div>
      </div>

      <div id="print-area-thermal" className="hidden">
        <div className="flex justify-center mb-1"><HMLogo className="w-16 h-16" /></div>
        <div className="text-center font-bold">HAIRI MUSTAFA ASSOCIATES</div>
        <div className="text-center text-[10px]">Peguam Syarie & PJS</div>
        <div className="text-center text-[10px]">011-5653 1310</div>
        <div className="border-b border-dashed border-black my-1"></div>
        <div className="text-[10px]">Tarikh: {formatDateForDisplay(clientForm.date)}</div>
        <div className="text-[10px]">Nama: {clientForm.name}</div>
        {printerSettings.includePhone && clientForm.phone && <div className="text-[10px]">Tel: {clientForm.phone}</div>}
        {printerSettings.includeAddress && clientForm.address && <div className="text-[10px]">Alamat: {clientForm.address}</div>}
        <div className="border-b border-dashed border-black my-1"></div>
        {cart.map((item, i) => (
          <div key={i} className="flex justify-between text-[10px]"><span>{item.name}</span><span>{item.price.toFixed(2)}</span></div>
        ))}
        <div className="border-b border-dashed border-black my-1"></div>
        <div className="flex justify-between font-bold text-[12px]"><span>JUMLAH:</span><span>RM {total.toFixed(2)}</span></div>
        <div className="text-center text-[10px] mt-2 italic">{printerSettings.footerText}</div>
      </div>
    </div>
  );
};

export default App;
