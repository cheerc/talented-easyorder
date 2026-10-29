import { createContext, useContext } from 'react';

export const OperatorContext = createContext<{ name: string; epoch: number; signOut: () => void } | null>(null);
export const useOperator = () => useContext(OperatorContext);
