import { BankTransaction, BookEntry, ReconciliationItem, MatchStatus } from './types';

export const parseCSV = (csvText: string): any[] => {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse headers
  const headers = lines[0].split(',').map(h => h.trim());

  const data: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const currentLine = lines[i];
    if (!currentLine.trim()) continue;

    const row: any = {};
    let inQuotes = false;
    let currentField = '';
    let fieldIndex = 0;

    for (let charIndex = 0; charIndex < currentLine.length; charIndex++) {
      const char = currentLine[charIndex];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        if (fieldIndex < headers.length) {
            row[headers[fieldIndex]] = currentField.trim();
        }
        currentField = '';
        fieldIndex++;
      } else {
        currentField += char;
      }
    }
    // Add the last field
    if (fieldIndex < headers.length) {
        row[headers[fieldIndex]] = currentField.trim();
    }
    
    data.push(row);
  }
  return data;
};

export const parseAmount = (amountStr: string | number): number => {
    if (typeof amountStr === 'number') return amountStr;
    if (!amountStr) return 0;
    // Remove quotes and commas
    const cleanStr = amountStr.replace(/["',]/g, '');
    return parseFloat(cleanStr);
};

export const reconcileData = (bankData: any[], bookData: any[]): ReconciliationItem[] => {
    const items: ReconciliationItem[] = [];
    const usedBookIds = new Set<string>();

    // 1. Convert raw data to typed objects with parsed amounts
    const bankTransactions: BankTransaction[] = bankData.map(row => ({
        ...row,
        total_amount: parseAmount(row.total_amount),
        amount_before_vat: parseAmount(row.amount_before_vat),
        vat: parseAmount(row.vat),
        original_row: row
    }));

    const bookEntries: BookEntry[] = bookData.map(row => ({
        ...row,
        amount: parseAmount(row.amount),
        original_row: row
    }));

    // 2. Iterate through Bank Transactions to find matches in Book
    bankTransactions.forEach(bankTx => {
        // Try to find a book entry with matching invoice/description
        // We look for book entries that haven't been used yet
        const matchedBookEntry = bookEntries.find(book => 
            !usedBookIds.has(book.document_no) && 
            book.description === bankTx.invoice_number
        );

        const item: ReconciliationItem = {
            id: `BANK-${bankTx.invoice_number}-${Math.random().toString(36).substr(2, 9)}`,
            bankTransaction: bankTx,
            difference: 0,
            status: MatchStatus.MISSING_IN_BOOK
        };

        if (matchedBookEntry) {
            item.bookEntry = matchedBookEntry;
            usedBookIds.add(matchedBookEntry.document_no);

            // Calculate difference
            const diff = Math.abs(bankTx.total_amount - matchedBookEntry.amount);
            item.difference = parseFloat(diff.toFixed(2));

            if (item.difference < 0.01) {
                item.status = MatchStatus.MATCHED;
            } else {
                item.status = MatchStatus.DISCREPANCY_AMOUNT;
            }
        } else {
            // Check for potential errors (e.g. description mismatch but amount match on same day?)
            // For now, simple logic: if not found by ID, it's Missing in Book
            item.status = MatchStatus.MISSING_IN_BOOK;
            item.difference = bankTx.total_amount;
        }

        items.push(item);
    });

    // 3. Find Book Entries that were not matched (Missing in Bank)
    bookEntries.forEach(bookEntry => {
        if (!usedBookIds.has(bookEntry.document_no)) {
            items.push({
                id: `BOOK-${bookEntry.document_no}-${Math.random().toString(36).substr(2, 9)}`,
                bookEntry: bookEntry,
                status: MatchStatus.MISSING_IN_BANK,
                difference: bookEntry.amount
            });
        }
    });

    return items;
};
