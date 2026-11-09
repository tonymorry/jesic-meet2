/**
 * JESic Meet - SetGooglePasswordModal
 * Junior Enterprise Sicilia
 * 
 * Schermata obbligatoria che si attiva subito quando un utente accede con Google
 * e non ha ancora impostato una password sul proprio account.
 * Permette di impostare una password personale in modo che possa poi accedere
 * sia tramite Google sia tramite email e password.
 */

import React, { useState } from 'react';
import { User } from '../types';
import { Lock, Eye, EyeOff, KeyRound, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';

interface SetGooglePasswordModalProps {
  user: User;
  onPasswordSet: (updatedUser: User) => void;
}

export const SetGooglePasswordModal: React.FC<SetGooglePasswordModalProps> = ({
  user,
  onPasswordSet,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanPass = password.trim();
    if (!cleanPass) {
      setErrorMsg('Inserisci una password.');
      return;
    }

    if (cleanPass.length < 6) {
      setErrorMsg('La password deve contenere almeno 6 caratteri.');
      return;
    }

    if (cleanPass !== confirmPassword.trim()) {
      setErrorMsg('Le password inserite non coincidono. Riprova.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/users/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          password: cleanPass,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Errore durante il salvataggio della password.');
        return;
      }

      const updatedUser: User = {
        ...user,
        ...data.user,
        hasPassword: true,
      };

      onPasswordSet(updatedUser);
    } catch (err: any) {
      console.error('Errore salvataggio password Google user:', err);
      setErrorMsg('Errore di connessione. Riprova tra poco.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-[#1e1e1e] rounded-3xl shadow-2xl border border-neutral-200 dark:border-neutral-800 p-6 sm:p-8 text-neutral-900 dark:text-neutral-100 space-y-5">
        
        {/* Testata Modale con Logo e Icona */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-red-100 dark:bg-red-950/70 text-[#f23e2e] flex items-center justify-center shadow-md border border-red-200 dark:border-red-900">
            <KeyRound className="w-7 h-7 stroke-[2.2px]" />
          </div>
          
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 dark:bg-red-950/40 text-[#f23e2e] text-[11px] font-bold border border-red-200 dark:border-red-900">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Configurazione Iniziale Sicurezza</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-neutral-900 dark:text-white tracking-tight">
            Imposta la tua Password
          </h2>
          
          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
            Accesso effettuato con Google ({user.email}). Imposta ora una password per accedere in futuro sia tramite <strong>Google</strong> sia con <strong>email e password</strong>.
          </p>
        </div>

        {/* Messaggio di Errore */}
        {errorMsg && (
          <div className="bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs px-4 py-3 rounded-2xl font-medium animate-in fade-in">
            {errorMsg}
          </div>
        )}

        {/* Form di Inserimento Password */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-400 mb-1.5">
              Nuova Password (minimo 6 caratteri) *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Inserisci la tua password"
                className="w-full pl-10 pr-10 py-2.5 bg-neutral-50 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl text-xs font-semibold focus:bg-white dark:focus:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-[#f23e2e] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-2.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-400 mb-1.5">
              Conferma Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ripeti la password"
                className="w-full pl-10 pr-10 py-2.5 bg-neutral-50 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl text-xs font-semibold focus:bg-white dark:focus:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-[#f23e2e] transition-all"
              />
            </div>
          </div>

          <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-2xl border border-neutral-200 dark:border-neutral-700 text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
            <span className="font-bold text-neutral-700 dark:text-neutral-300">Nota:</span> Questa password ti permetterà di entrare nell&apos;app in qualsiasi momento anche se non puoi usare Google OAuth.
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3 bg-[#f23e2e] hover:bg-red-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer disabled:opacity-60"
          >
            {isSaving ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Salvataggio password in corso...</span>
              </>
            ) : (
              <>
                <span>Salva Password ed Entra</span>
                <CheckCircle2 className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  );
};
