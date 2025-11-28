export interface BankTransaction {
  account_no: string;
  transaction_date: string;
  time: string;
  invoice_number: string;
  product: string;
  amount_before_vat: number;
  vat: number;
  total_amount: number;
  merchant_id: string;
  fuel_brand: string;
  original_row: any;
}

export interface BookEntry {
  document_no: string;
  posting_date: string;
  description: string; // Maps to invoice_number
  amount: number;
  original_row: any;
}

export enum MatchStatus {
  MATCHED = 'MATCHED',
  DISCREPANCY_AMOUNT = 'DISCREPANCY_AMOUNT',
  MISSING_IN_BOOK = 'MISSING_IN_BOOK',
  MISSING_IN_BANK = 'MISSING_IN_BANK',
  POTENTIAL_ERROR = 'POTENTIAL_ERROR' // Transposition, etc.
}

export interface ReconciliationItem {
  id: string;
  bankTransaction?: BankTransaction;
  bookEntry?: BookEntry;
  status: MatchStatus;
  difference: number;
  aiAnalysis?: string;
  confidence?: number;
  suggestedFix?: string;
}

export interface DashboardStats {
  totalBank: number;
  totalBook: number;
  matchedCount: number;
  discrepancyCount: number;
  missingInBookCount: number;
  accuracy: number;
}