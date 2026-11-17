/**
 * JESic Meet - Profilo Utente Personale
 * Junior Enterprise Sicilia
 * 
 * Funzionalità avanzate:
 * 1. Modale di Regolazione & Ritaglio Foto (Zoom, rotazione, trascinamento per centrare).
 * 2. Selezione da galleria avatar arricchita (include badge ufficiali JESic e figure professionali).
 * 3. Mostra immagine profilo accanto al nome.
 * 4. Controllo permessi di sistema ('admin', 'associate', 'client_admin').
 * 5. Sincronizzazione agenda e logout sicuro.
 */

import React, { useState, useRef, useEffect } from 'react';
import { AppRole, User, UserSystemRole, Group } from '../types';
import { useGoogleLogin } from '@react-oauth/google';
import { isIosStandalonePwa } from '../utils/pwaHelper';
import { startGoogleOAuthRedirect } from '../utils/googleOAuthPwa';
import {
  Mail,
  Calendar,
  CheckCircle,
  LogOut,
  Building,
  Shield,
  ShieldCheck,
  Award,
  Camera,
  Trash2,
  Upload,
  Check,
  X,
  Users,
  FileText,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { ImageCropModal } from './ImageCropModal';
import { UserAvatar } from './UserAvatar';
import { PushNotificationCard } from './PushNotificationCard';

interface ProfileViewProps {
  currentUser: User;
  allUsers?: User[];
  groups?: Group[];
  activeGroup?: Group | null;
  onLogout: () => void;
  onUpdateUserRole?: (targetUserId: string, newRole: AppRole) => void;
  onUpdateUserProfile?: (updates: Partial<User>) => void;
  onConnectGoogleCalendar?: (code: string, grantedScope?: string) => Promise<void>;
  onNavigateToPrivacy?: () => void;
  onNavigateToTerms?: () => void;
}



export const ProfileView: React.FC<ProfileViewProps> = ({
  currentUser,
  allUsers = [],
  groups = [],
  activeGroup = null,
  onLogout,
  onUpdateUserRole,
  onUpdateUserProfile,
  onConnectGoogleCalendar,
  onNavigateToPrivacy,
  onNavigateToTerms,
}) => {
  const [calendarConnected, setCalendarConnected] = useState(
    currentUser.googleCalendarConnected ?? false
  );
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [cropImageSource, setCropImageSource] = useState<string | null>(null);

  useEffect(() => {
    setCalendarConnected(Boolean(currentUser.googleCalendarConnected));
  }, [currentUser.googleCalendarConnected]);

  const hasCalendarAuth = Boolean(
    currentUser.hasGoogleCalendarAuth ||
      currentUser.hasGoogleRefreshToken ||
      currentUser.googleAccessToken
  );

  const connectGoogleCalendar = useGoogleLogin({
    flow: 'auth-code',
    scope: 'https://www.googleapis.com/auth/calendar.events.owned',
    select_account: true,
    onSuccess: async (codeResponse) => {
      if (!codeResponse.code) {
        setIsConnectingCalendar(false);
        return;
      }
      try {
        if (onConnectGoogleCalendar) {
          await onConnectGoogleCalendar(codeResponse.code, codeResponse.scope);
          setCalendarConnected(true);
          showNotification('Google Calendar collegato con successo!');
        }
      } catch (err: any) {
        showNotification(err?.message || 'Errore durante il collegamento con Google Calendar.');
      } finally {
        setIsConnectingCalendar(false);
      }
    },
    onError: () => {
      setIsConnectingCalendar(false);
      showNotification('Autorizzazione Google Calendar non completata o annullata.');
    },
    onNonOAuthError: (nonOAuthErr) => {
      if (nonOAuthErr.type === 'popup_failed_to_open') {
        if (isIosStandalonePwa()) {
          startGoogleOAuthRedirect({
            mode: 'link_calendar',
            linkToUserId: currentUser.id,
            loginHint: currentUser.email,
            fromPwa: true,
          }).catch((err: any) => {
            setIsConnectingCalendar(false);
            showNotification(err?.message || 'Impossibile avviare il collegamento con Google.');
          });
          return;
        }
        setIsConnectingCalendar(false);
        showNotification('Popup Google bloccato dal browser. Consenti i popup per questo sito e riprova.');
        return;
      }
      setIsConnectingCalendar(false);
    },
  });

  useEffect(() => {
    if (!isConnectingCalendar) return;
    const handleReturn = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => setIsConnectingCalendar(false), 1200);
      }
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, [isConnectingCalendar]);

  const triggerConnectGoogleCalendar = async () => {
    setIsConnectingCalendar(true);
    if (isIosStandalonePwa()) {
      try {
        await startGoogleOAuthRedirect({
          mode: 'link_calendar',
          linkToUserId: currentUser.id,
          loginHint: currentUser.email,
          fromPwa: true,
        });
      } catch (err: any) {
        setIsConnectingCalendar(false);
        showNotification(err?.message || 'Errore durante il collegamento con Google Calendar.');
      }
      return;
    }
    connectGoogleCalendar();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calcolo dei gruppi a cui appartiene l'utente e dei rispettivi ruoli
  const userGroups = groups.filter(
    (g) => g.creatorId === currentUser.id || g.members?.some((m) => m.userId === currentUser.id)
  );

  // Ruolo nel gruppo attivo se ci troviamo dentro un gruppo
  const activeGroupMembership = activeGroup?.members?.find((m) => m.userId === currentUser.id);
  const activeGroupRole = activeGroup
    ? (activeGroupMembership?.role || (activeGroup.creatorId === currentUser.id ? 'admin' : 'member'))
    : null;
  const currentSystemRole = currentUser.systemRole || 'user';

  const showNotification = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  // Lettura file immagine da dispositivo -> Apertura Editor di Ritaglio
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showNotification('Seleziona un file immagine valido (JPG, PNG o WEBP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      setCropImageSource(uploadEvent.target?.result as string);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      showNotification('Errore nella lettura del file immagine.');
    };
    reader.readAsDataURL(file);
  };

  // Salvataggio foto ritagliata
  const handleCropComplete = (croppedDataUrl: string) => {
    onUpdateUserProfile?.({ avatarUrl: croppedDataUrl });
    setCropImageSource(null);
    showNotification('Foto profilo ritagliata e salvata con successo!');
  };



  const handleRemovePhoto = () => {
    onUpdateUserProfile?.({ avatarUrl: undefined });
    showNotification('Foto profilo rimossa. Utilizzate le tue iniziali.');
  };

  return (
    <div className="flex flex-col gap-5 pb-8 max-w-md mx-auto sm:max-w-xl md:max-w-3xl lg:max-w-4xl px-4 sm:px-6 pt-2">
      
      {/* Toast Notifica Aggiornamento */}
      {feedbackMsg && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-200 animate-in fade-in slide-in-from-top-2 shadow-sm">
          <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[3px]" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Scheda Identità Personale JESic & Foto Profilo */}
      <div className="bg-white dark:bg-neutral-900 rounded-3xl p-5 sm:p-6 border border-neutral-200/90 dark:border-neutral-800 shadow-xs relative overflow-hidden transition-colors space-y-4">
        
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          {/* Avatar Circolare Principale Direttamente Cliccabile */}
          <div className="relative group self-center sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setIsAvatarMenuOpen(true)}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shadow-lg shadow-black/10 border-2 border-white dark:border-neutral-800 ring-2 ring-neutral-200 dark:ring-neutral-700 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center relative cursor-pointer group hover:ring-[#f23e2e] transition-all hover:scale-105 active:scale-95"
              title="Clicca per cambiare foto o scegliere un avatar"
            >
              {currentUser.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={`${currentUser.name} avatar`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#f23e2e] via-red-600 to-red-800 text-white font-black text-3xl sm:text-4xl flex items-center justify-center shadow-inner">
                  {currentUser.name[0]}
                </div>
              )}

              {/* Overlay hover per indicare il click */}
              <div className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 rounded-full">
                <Camera className="w-5 h-5 text-white" />
                <span className="text-[9px] font-black uppercase tracking-wider">Modifica</span>
              </div>
            </button>

            {/* Badge galleggiante fotocamera */}
            <button
              type="button"
              onClick={() => setIsAvatarMenuOpen(true)}
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#f23e2e] hover:bg-red-600 text-white shadow-md shadow-red-500/30 flex items-center justify-center border-2 border-white dark:border-neutral-900 transition-all cursor-pointer hover:scale-110 active:scale-95"
              title="Modifica foto profilo"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>

            {/* File input nascosto per upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoUpload}
            />
          </div>

          {/* Dati Anagrafici e Ruoli */}
          <div className="space-y-1.5 flex-1 min-w-0 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-1.5 flex-wrap">
              {activeGroup ? (
                <span
                  className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
                    activeGroupRole === 'admin'
                      ? 'bg-red-100 dark:bg-red-950/60 text-[#f23e2e] border border-red-200 dark:border-red-900/40 shadow-xs'
                      : activeGroupRole === 'admin_clienti'
                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40 shadow-xs'
                      : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  {activeGroupRole === 'admin' ? (
                    <>
                      <ShieldCheck className="w-3 h-3 text-[#f23e2e]" />
                      <span>⚡ Admin ({activeGroup.name})</span>
                    </>
                  ) : activeGroupRole === 'admin_clienti' ? (
                    <>
                      <ShieldCheck className="w-3 h-3 text-amber-600" />
                      <span>🏢 Admin Clienti ({activeGroup.name})</span>
                    </>
                  ) : (
                    <>
                      <Award className="w-3 h-3 text-neutral-500" />
                      <span>👤 Membro ({activeGroup.name})</span>
                    </>
                  )}
                </span>
              ) : null}
            </div>

            {/* Nome Utente con anteprima immagine profilo accanto */}
            <div className="flex items-center justify-center sm:justify-start gap-2.5 truncate">
              <UserAvatar user={currentUser} size="sm" />
              <h2 className="text-xl font-black text-neutral-900 dark:text-white truncate">
                {currentUser.name} {currentUser.surname}
              </h2>
            </div>

            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate flex items-center justify-center sm:justify-start gap-1.5">
              <Mail className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>{currentUser.email}</span>
            </p>
          </div>
        </div>

        {/* Modal Scelta Azioni Avatar (Aperto cliccando sull'Avatar circolare) */}
        {isAvatarMenuOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-3xl p-5 border border-neutral-200 dark:border-neutral-800 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/60 text-[#f23e2e] flex items-center justify-center">
                    <Camera className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-black text-neutral-900 dark:text-white">
                    Foto Profilo
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAvatarMenuOpen(false)}
                  className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAvatarMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/70 hover:bg-red-50 dark:hover:bg-red-950/30 border border-neutral-200 dark:border-neutral-700 hover:border-[#f23e2e] flex items-center gap-3 transition-all cursor-pointer text-left group"
                >
                  <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-950/60 text-[#f23e2e] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-neutral-900 dark:text-white group-hover:text-[#f23e2e]">
                      Carica e Ritaglia Foto
                    </p>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                      Seleziona una foto dal tuo dispositivo ed effettua il crop
                    </p>
                  </div>
                </button>



                {currentUser.avatarUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      handleRemovePhoto();
                    }}
                    className="w-full p-3 rounded-2xl bg-red-50/70 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/60 border border-red-200/60 dark:border-red-900/40 flex items-center gap-3 transition-all cursor-pointer text-left text-red-600 dark:text-red-400"
                  >
                    <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-300 flex items-center justify-center shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold">Rimuovi Foto Profilo</p>
                      <p className="text-[10px] text-red-500/80">Torna all'avatar con la tua iniziale</p>
                    </div>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}



        <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
          <span className="flex items-center gap-1 font-medium">
            <Building className="w-3.5 h-3.5 text-neutral-400" />
            Junior Enterprise Sicilia
          </span>
          <span className="text-[11px] font-mono text-neutral-400">
            Area Personale Riservata
          </span>
        </div>
      </div>

      {/* Scheda Informativa "I tuoi Ruoli nei Gruppi" (Read-only, gestiti dal DB) */}
      <div className="bg-white dark:bg-neutral-900 rounded-3xl p-5 border border-neutral-200/90 dark:border-neutral-800 shadow-xs space-y-3.5 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/50 text-[#f23e2e] flex items-center justify-center shadow-xs">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-neutral-900 dark:text-white uppercase tracking-wider">
                I Tuoi Ruoli nei Gruppi
              </h3>
            </div>
          </div>
          <span className="text-xs font-bold text-neutral-400">
            {userGroups.length} {userGroups.length === 1 ? 'gruppo' : 'gruppi'}
          </span>
        </div>

        {userGroups.length === 0 ? (
          <p className="text-xs text-neutral-400 italic p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl">
            Non fai ancora parte di alcun gruppo di lavoro. Cerca un gruppo nella Home o unisciti tramite codice.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {userGroups.map((grp) => {
              const mem = grp.members?.find((m) => m.userId === currentUser.id);
              const isCreator = grp.creatorId === currentUser.id;
              const role = mem?.role || (isCreator ? 'admin' : 'member');
              const isAdmin = isCreator || role === 'admin';
              const isAdminClienti = role === 'admin_clienti';

              return (
                <div
                  key={grp.id}
                  className="p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg p-1 bg-white dark:bg-neutral-700 rounded-lg shadow-2xs shrink-0">
                      {grp.avatar || '👥'}
                    </span>
                    <span className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                      {grp.name}
                    </span>
                  </div>

                  <span
                    className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                      isCreator
                        ? 'bg-red-100 dark:bg-red-950/60 text-[#f23e2e] border border-red-200/60 dark:border-red-900/40'
                        : isAdmin
                        ? 'bg-red-100 dark:bg-red-950/60 text-[#f23e2e]'
                        : isAdminClienti
                        ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                        : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {isCreator
                      ? '👑 Creatore (Admin)'
                      : isAdmin
                      ? '⚡ Admin'
                      : isAdminClienti
                      ? '🏢 Admin Clienti'
                      : '👤 Membro'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sincronizzazione Google Calendar */}
      <div className="bg-white dark:bg-neutral-900 rounded-3xl p-4 sm:p-5 border border-neutral-200/90 dark:border-neutral-800 shadow-xs space-y-3.5 transition-colors">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-50 dark:bg-red-950/50 text-[#f23e2e] flex items-center justify-center shadow-xs shrink-0">
              <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-neutral-900 dark:text-white leading-tight">
                  Google Calendar Sincronizzato
                </h3>
                <span className={`text-[8.5px] sm:text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                  calendarConnected && hasCalendarAuth
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                }`}>
                  {calendarConnected && hasCalendarAuth
                    ? 'Collegato'
                    : hasCalendarAuth
                    ? 'Disattivato'
                    : 'Da Autorizzare'}
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 font-mono truncate">
                {currentUser.email}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={calendarConnected}
            onClick={() => {
              const nextState = !calendarConnected;
              if (nextState && !hasCalendarAuth && onConnectGoogleCalendar) {
                triggerConnectGoogleCalendar();
                return;
              }
              setCalendarConnected(nextState);
              onUpdateUserProfile?.({ googleCalendarConnected: nextState });
              showNotification(
                nextState
                  ? 'Sincronizzazione automatica con Google Calendar attivata!'
                  : 'Sincronizzazione Google Calendar disattivata.'
              );
            }}
            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-red-500/40 select-none ${
              calendarConnected && hasCalendarAuth ? 'bg-[#f23e2e]' : 'bg-neutral-300 dark:bg-neutral-700'
            }`}
            title="Attiva/disattiva sincronizzazione automatica Google Calendar"
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                calendarConnected && hasCalendarAuth ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {hasCalendarAuth ? (
          <div className="p-3 sm:p-3.5 bg-neutral-50 dark:bg-neutral-800/60 rounded-2xl border border-neutral-100 dark:border-neutral-800 space-y-2.5">
            <div className="text-xs text-neutral-600 dark:text-neutral-300 flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-[11px] sm:text-xs font-medium text-neutral-700 dark:text-neutral-200 leading-relaxed">
                {calendarConnected
                  ? <>Ogni evento viene inserito automaticamente nel Google Calendar di <span className="font-mono text-neutral-900 dark:text-white font-bold break-all">{currentUser.email}</span>.</>
                  : 'La sincronizzazione è al momento disattivata. Attiva lo switch sopra per riprendere.'}
              </p>
            </div>
            {!currentUser.hasGoogleRefreshToken && onConnectGoogleCalendar && (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-200/70 dark:border-neutral-700/60">
                <p className="text-[10px] text-amber-700 dark:text-amber-400">
                  Sessione temporanea: ricollega per abilitare il rinnovo automatico offline.
                </p>
                <button
                  type="button"
                  onClick={triggerConnectGoogleCalendar}
                  disabled={isConnectingCalendar}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[10px] font-bold text-neutral-800 dark:text-neutral-100 hover:border-[#f23e2e] flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isConnectingCalendar ? 'animate-spin' : ''}`} />
                  <span>{isConnectingCalendar ? 'Collegamento...' : 'Ricollega'}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 sm:p-3.5 bg-amber-50/70 dark:bg-amber-950/30 rounded-2xl border border-amber-200/80 dark:border-amber-900/50 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] sm:text-xs font-medium text-amber-900 dark:text-amber-200 leading-relaxed">
                Google Calendar non risulta ancora autorizzato su questo profilo. Collega il tuo account Google concedendo il permesso sul calendario.
              </p>
            </div>
            {onConnectGoogleCalendar && (
              <button
                type="button"
                onClick={triggerConnectGoogleCalendar}
                disabled={isConnectingCalendar}
                className="w-full py-2 px-3 bg-[#f23e2e] hover:bg-red-600 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>{isConnectingCalendar ? 'Autorizzazione in corso...' : 'Collega Google Calendar'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scheda Gestione Notifiche Push Reali (Stile WhatsApp) */}
      <PushNotificationCard
        currentUser={currentUser}
        onNotificationFeedback={(msg) => showNotification(msg)}
      />

      {/* Trasparenza & Informazioni Legali (Google OAuth & GDPR) */}
      <div className="bg-white dark:bg-neutral-900 rounded-3xl p-5 border border-neutral-200/90 dark:border-neutral-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-neutral-900 dark:text-white">
          <Shield className="w-4 h-4 text-[#f23e2e]" />
          <span>Trasparenza & Informazioni Legali</span>
        </div>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
          JESic Meet rispetta la tua privacy e la Google API Services User Data Policy. I dati del calendario sono usati esclusivamente per le disponibilità del team.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <a
            href="/privacy"
            onClick={(e) => {
              if (onNavigateToPrivacy) {
                e.preventDefault();
                onNavigateToPrivacy();
              }
            }}
            className="flex-1 min-w-[130px] p-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-700 text-xs font-bold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#f23e2e]" />
            <span>Privacy Policy</span>
          </a>
          <a
            href="/terms"
            onClick={(e) => {
              if (onNavigateToTerms) {
                e.preventDefault();
                onNavigateToTerms();
              }
            }}
            className="flex-1 min-w-[130px] p-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-700 text-xs font-bold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-neutral-500" />
            <span>Termini di Servizio</span>
          </a>
        </div>
      </div>

      {/* Disconnessione */}
      <div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full p-3.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 text-red-700 dark:text-red-400 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-colors border border-red-200 dark:border-red-900/60 shadow-2xs cursor-pointer active:scale-95"
        >
          <LogOut className="w-4 h-4 text-[#f23e2e]" />
          <span>Disconnetti il mio profilo (Logout)</span>
        </button>
      </div>

      {/* Modale Regolazione & Ritaglio Foto */}
      {cropImageSource && (
        <ImageCropModal
          imageSrc={cropImageSource}
          onClose={() => setCropImageSource(null)}
          onCropComplete={handleCropComplete}
        />
      )}

    </div>
  );
};
