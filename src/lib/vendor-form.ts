import type { PromptField } from '#/components/dialogs'

/** The vendor details Tanya asked for (PT name, NPWP, address, PIC, phone, email, bank, account no.). */
export type VendorDetails = {
  name?: string | null
  legalEntity?: string | null
  npwp?: string | null
  address?: string | null
  picName?: string | null
  phone?: string | null
  email?: string | null
  bankName?: string | null
  accountName?: string | null
  bankAccount?: string | null
}

export function vendorFields(v?: VendorDetails): PromptField[] {
  const f = (name: keyof VendorDetails, label: string, hint?: string): PromptField => ({
    name,
    label,
    defaultValue: v?.[name] ?? '',
    hint,
    required: false,
  })
  return [
    { ...f('name', 'Vendor name', 'The name picked on vendor invoices'), required: true },
    f('legalEntity', 'PT name', 'As on their invoice, e.g. PT Pamarta Pratama Pradipta'),
    f('npwp', 'NPWP'),
    f('address', 'Address'),
    f('picName', 'PIC name'),
    f('phone', 'Phone'),
    f('email', 'Email'),
    f('bankName', 'Bank name', 'e.g. BCA, Mandiri'),
    f('accountName', 'Account holder name'),
    f('bankAccount', 'Account number'),
  ]
}

export function vendorData(v: Record<string, string>) {
  const t = (k: string) => v[k]?.trim() || null
  return {
    name: v.name.trim(),
    legalEntity: t('legalEntity'),
    npwp: t('npwp'),
    address: t('address'),
    picName: t('picName'),
    phone: t('phone'),
    email: t('email'),
    bankName: t('bankName'),
    accountName: t('accountName'),
    bankAccount: t('bankAccount'),
  }
}
