
export interface Service {
  id: string;
  name: string;
  price: number;
}

export interface ClientRecord {
  id: string;
  date: string;
  name: string;
  phone: string;
  address: string;
  items: string;
  total: number;
  payment: string;
  cartItems: CartItem[];
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
}

export enum PaymentMethod {
  TUNAI = 'Tunai',
  ONLINE = 'Online Transfer',
  QR = 'DuitNow QR'
}

export interface PrinterSettings {
  paperWidth: '58mm' | '80mm';
  fontSize: 'Small' | 'Normal' | 'Large';
  extraFeeds: number;
  boldHeaders: boolean;
  footerText: string;
  googleSheetUrl?: string;
  googleAppsScriptUrl?: string;
  autoSaveInterval: number;
  autoSync: boolean;
  includePhone: boolean;
  includeAddress: boolean;
}

export interface BluetoothState {
  device: any | null;
  characteristic: any | null;
  status: string;
  connected: boolean;
}

declare global {
  interface Navigator {
    bluetooth: any;
  }
}
