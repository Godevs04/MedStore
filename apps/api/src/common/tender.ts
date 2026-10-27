/** Settlement account for a tender: cash drawer vs bank-cleared instruments (UPI, card, bank). */
export function tenderAccount(method: string): 'CASH' | 'BANK' {
  return method === 'CASH' ? 'CASH' : 'BANK';
}
