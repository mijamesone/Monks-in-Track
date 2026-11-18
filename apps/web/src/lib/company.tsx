import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** The global company switcher: 'all' or a company id. Remembered on this computer. */
const CompanyCtx = createContext<{ companyId: string; setCompanyId: (id: string) => void }>({ companyId: 'all', setCompanyId: () => {} });

const KEY = 'mt.company';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companyId, setCompanyId] = useState(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, companyId);
    } catch {
      /* private mode: just not remembered */
    }
  }, [companyId]);
  return <CompanyCtx.Provider value={{ companyId, setCompanyId }}>{children}</CompanyCtx.Provider>;
}

export const useCompany = () => useContext(CompanyCtx);
