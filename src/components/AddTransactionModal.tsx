import React from 'react';
import EntrySheet from './EntrySheet';
import type { Entry } from '../types';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editing?: Entry | null;
}

export default function AddTransactionModal({ isOpen, onClose, editing }: AddTransactionModalProps) {
  return (
    <EntrySheet 
      open={isOpen} 
      onClose={onClose} 
      editing={editing || null} 
    />
  );
}
