/**
 * JESic Meet - GroupWorkspaceHeader
 * 
 * Barra superiore visualizzata quando l'utente entra all'interno di un Gruppo o Sottogruppo:
 * - Mostra sotto al nome del gruppo il ruolo dell'utente ("Tuo ruolo: Responsabile", "Admin", ecc.)
 * - Quando si entra in un Sottogruppo:
 *   - Livello visivo identico a un gruppo indipendente
 *   - Mostra sotto al nome: "Gruppo principale: {activeGroup.name}" e "Tuo ruolo: {ruolo}"
 *   - Il tasto con la freccetta indietro torna direttamente al Gruppo Principale
 *   - Personalizzazione del sottogruppo completa (Nome, Icona, Descrizione, Pubblico/Privato)
 *   - Codice univoco d'accesso del sottogruppo, link e membri dedicati
 */

import React, { useState, useRef } from 'react';
import { Group, User, Subgroup } from '../types';
import { GroupAvatar } from './GroupAvatar';
import { PRESET_COLORS } from './SubgroupsDrawer';
import {
  ArrowLeft,
  Users,
  Check,
  Trash2,
  X,
  AlertTriangle,
  Settings,
  Image as ImageIcon,
  Upload,
  MoreHorizontal,
} from 'lucide-react';

export interface GroupWorkspaceHeaderProps {
  activeGroup: Group;
  activeSubgroup?: Subgroup | null;
  currentUser: User;
  allUsers: User[];
  onBackToGroups: () => void;
  onBackToMainGroup?: () => void;
  onSelectSubgroup?: (subgroupId: string | null) => void;
  onOpenMembersModal: () => void;
  onToggleSubgroupsMenu?: () => void;
  onUpdateGroupName?: (groupId: string, newName: string) => Promise<boolean | void>;
  onUpdateGroup?: (
    groupId: string,
    data: { name: string; description?: string; avatar?: string; isPublic?: boolean }
  ) => Promise<boolean | void>;
  onDeleteGroup?: (groupId: string) => Promise<boolean | void>;
  onUpdateSubgroup?: (
    subgroupId: string,
    data: { name: string; description?: string; avatar?: string; color?: string; isPublic?: boolean }
  ) => Promise<boolean | void>;
  onDeleteSubgroup?: (subgroupId: string) => Promise<boolean | void>;
}

const PRESET_ICONS = ['📁', '🚀', '💡', '💻', '📊', '🎯', '⚡', '🏢', '🔥', '🎓', '🎨', '💼', '⭐', '🛠️', '👥'];

export const GroupWorkspaceHeader: React.FC<GroupWorkspaceHeaderProps> = ({
  activeGroup,
  activeSubgroup,
  currentUser,
  allUsers,
  onBackToGroups,
  onBackToMainGroup,
  onSelectSubgroup,
  onOpenMembersModal,
  onToggleSubgroupsMenu,
  onUpdateGroupName,
  onUpdateGroup,
  onDeleteGroup,
  onUpdateSubgroup,
  onDeleteSubgroup,
}) => {
  // Modale Eliminazione
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modale Unificata Modifica / Personalizzazione Completa (Gruppo Principale o Sottogruppo)
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAvatar, setEditAvatar] = useState('📁');
  const [editColor, setEditColor] = useState('#8b5cf6');
  const [showAllIcons, setShowAllIcons] = useState(false);
  const [showAllColors, setShowAllColors] = useState(false);
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleCustomImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("L'immagine non può superare 8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 160;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setEditAvatar(dataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const userMembership = activeGroup.members?.find((m) => m.userId === currentUser.id);
  const isGroupCreator = activeGroup.creatorId === currentUser.id;
  const currentGroupRole = isGroupCreator ? 'admin' : (userMembership?.role || 'member');
  const isGroupAdmin = isGroupCreator || currentGroupRole === 'admin';
  const isGroupAdminClienti = currentGroupRole === 'admin_clienti';
  const isGroupResponsabile = currentGroupRole === 'responsabile';
  const isSubgroupCreator = Boolean(activeSubgroup && activeSubgroup.createdBy === currentUser.id);
  const isSubgroupCreatorAdmin = Boolean(activeSubgroup && isSubgroupCreator && currentGroupRole === 'responsabile');

  // Autorizzazioni: nel sottogruppo possono gestire l'admin del gruppo, il creatore del gruppo, o il creatore di quel sottogruppo
  const canManageCurrent = activeSubgroup
    ? isGroupAdmin || isGroupCreator || isSubgroupCreator
    : isGroupAdmin || isGroupCreator;

  // Codice e Link (del sottogruppo o del gruppo principale)
  const currentCode = activeSubgroup?.code || activeGroup.code;
  const isCurrentPublic = activeSubgroup ? Boolean(activeSubgroup.isPublic) : Boolean(activeGroup.isPublic);


  // Apertura modale personalizzazione per Gruppo o Sottogruppo
  const handleOpenCustomizeModal = () => {
    if (activeSubgroup) {
      setEditName(activeSubgroup.name);
      setEditDesc(activeSubgroup.description || '');
      setEditAvatar(activeSubgroup.avatar || '📁');
      setEditColor(activeSubgroup.color || '#8b5cf6');
      setEditIsPublic(Boolean(activeSubgroup.isPublic));
    } else {
      setEditName(activeGroup.name);
      setEditDesc(activeGroup.description || '');
      setEditAvatar(activeGroup.avatar || '👥');
      setEditIsPublic(Boolean(activeGroup.isPublic));
    }
    setIsCustomizeOpen(true);
  };

  const handleSaveCustomization = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = editName.trim();
    if (!clean) return;

    setIsSavingCustomization(true);
    try {
      if (activeSubgroup && onUpdateSubgroup) {
        await onUpdateSubgroup(activeSubgroup.id, {
          name: clean,
          description: editDesc.trim(),
          avatar: editAvatar,
          color: editColor,
          isPublic: editIsPublic,
        });
      } else if (onUpdateGroup) {
        await onUpdateGroup(activeGroup.id, {
          name: clean,
          description: editDesc.trim(),
          avatar: editAvatar,
          isPublic: editIsPublic,
        });
      } else if (onUpdateGroupName) {
        await onUpdateGroupName(activeGroup.id, clean);
      }
      setIsCustomizeOpen(false);
    } finally {
      setIsSavingCustomization(false);
    }
  };

  // Conferma eliminazione
  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      if (activeSubgroup && onDeleteSubgroup) {
        await onDeleteSubgroup(activeSubgroup.id);
        setShowDeleteConfirm(false);
        if (onBackToMainGroup) {
          onBackToMainGroup();
        }
      } else if (onDeleteGroup) {
        await onDeleteGroup(activeGroup.id);
        setShowDeleteConfirm(false);
        onBackToGroups();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Calcolo percorso gerarchico (Breadcrumbs: Gruppo Generale ➔ Sottogruppo ➔ Sotto-sottogruppo...)
  const breadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: activeGroup.name }];
  if (activeSubgroup) {
    const chain: Subgroup[] = [];
    let curr: Subgroup | undefined = activeSubgroup;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      chain.unshift(curr);
      if (curr.parentId) {
        curr = activeGroup.subgroups?.find((s) => s.id === curr!.parentId);
      } else {
        curr = undefined;
      }
    }
    chain.forEach((s) => breadcrumbs.push({ id: s.id, name: s.name }));
  }

  const subColor = activeSubgroup?.color || '#8b5cf6';

  return (
    <>
      <div
        className="bg-white dark:bg-neutral-900 border-b border-neutral-200/90 dark:border-neutral-800 shadow-2xs transition-colors mb-3.5 sm:mb-5 rounded-2xl sm:rounded-3xl p-3 sm:p-5 relative overflow-hidden"
        style={activeSubgroup ? {
          borderLeftWidth: '6px',
          borderLeftColor: subColor,
          backgroundImage: `linear-gradient(to right, ${subColor}14, transparent 55%)`,
          boxShadow: `0 4px 20px -2px ${subColor}25`,
        } : undefined}
      >
        <div className="flex items-center justify-between gap-2.5 sm:gap-4">
          {/* Tasto Torna Indietro + Avatar + Nome Gruppo */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            {/* Tasto Freccetta: se dentro un sottogruppo torna al livello superiore, altrimenti a I Tuoi Gruppi */}
            <button
              type="button"
              onClick={activeSubgroup ? (onBackToMainGroup || onBackToGroups) : onBackToGroups}
              className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-[#f23e2e] transition-all flex items-center justify-center cursor-pointer active:scale-95 shrink-0"
              title={
                activeSubgroup
                  ? (activeSubgroup.parentId ? 'Torna al sottogruppo superiore' : `Torna al gruppo principale "${activeGroup.name}"`)
                  : 'Torna alla lista dei tuoi gruppi'
              }
              aria-label="Torna indietro"
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5px]" />
            </button>

            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
              {/* Quadratone Avatar Icona o Immagine ingrandito: del Sottogruppo se attivo, altrimenti del Gruppo Principale */}
              <div
                className="shrink-0 p-1 sm:p-1.5 rounded-2xl transition-all flex items-center justify-center"
                style={activeSubgroup ? {
                  backgroundColor: `${subColor}22`,
                  border: `2px solid ${subColor}55`,
                  boxShadow: `0 2px 8px ${subColor}25`,
                } : undefined}
              >
                <GroupAvatar
                  avatar={activeSubgroup ? (activeSubgroup.avatar || '📁') : (activeGroup.avatar || '👥')}
                  name={activeSubgroup ? activeSubgroup.name : activeGroup.name}
                  size="md"
                  className="w-10 h-10 text-xl sm:w-12 sm:h-12 sm:text-2xl"
                  fallbackEmoji={activeSubgroup ? '📁' : '👥'}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h2
                    title={activeSubgroup ? activeSubgroup.name : activeGroup.name}
                    className="text-sm sm:text-lg font-black text-neutral-900 dark:text-white truncate leading-snug min-w-0"
                  >
                    {activeSubgroup ? activeSubgroup.name : activeGroup.name}
                  </h2>

                  {/* Accanto al nome: solo ed esclusivamente l'ingranaggio per modificare l'intero gruppo o sottogruppo */}
                  {canManageCurrent && (
                    <button
                      type="button"
                      onClick={handleOpenCustomizeModal}
                      className="p-1 sm:p-1.5 rounded-lg text-neutral-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
                      title={activeSubgroup ? 'Modifica sottogruppo' : 'Modifica gruppo'}
                      aria-label="Impostazioni gruppo"
                    >
                      <Settings className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                    </button>
                  )}

                  {/* Badge Privacy: solo icona lucchetto o globo */}
                  <span
                    title={isCurrentPublic ? 'Pubblico' : 'Privato'}
                    className={`text-xs px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 flex items-center justify-center border ${
                      isCurrentPublic
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-300/80 dark:border-emerald-800/60'
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    {isCurrentPublic ? '🌐' : '🔒'}
                  </span>
                </div>

                {/* SOTTO IL NOME: Breadcrumb gerarchico per sottogruppi (senza scritta ruolo) */}
                {breadcrumbs.length > 1 && (
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] sm:text-xs font-semibold text-neutral-500 dark:text-neutral-400 overflow-x-auto no-scrollbar max-w-full">
                    {breadcrumbs.map((crumb, idx) => {
                      const isLast = idx === breadcrumbs.length - 1;
                      return (
                        <React.Fragment key={crumb.id || 'root'}>
                          {idx > 0 && <span className="text-neutral-400 dark:text-neutral-600 text-[9.5px]">➔</span>}
                          {isLast ? (
                            <span className="font-bold text-neutral-800 dark:text-neutral-200 truncate max-w-[130px] sm:max-w-none">
                              {crumb.name}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (onSelectSubgroup) {
                                  onSelectSubgroup(crumb.id);
                                } else if (crumb.id === null && onBackToMainGroup) {
                                  onBackToMainGroup();
                                }
                              }}
                              className="font-bold text-[#f23e2e] hover:underline cursor-pointer truncate max-w-[110px] sm:max-w-none"
                              title={`Vai a ${crumb.name}`}
                            >
                              {crumb.name}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Azioni: UN UNICO PULSANTE Membri (ingrandito con icona + numero a fianco) + eventuale cestino */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Tasto Membri: icona con il numero esatto dei membri di questo spazio */}
            {(() => {
              const currentMembersCount = activeSubgroup
                ? Array.from(new Set([activeSubgroup.createdBy, ...(activeSubgroup.members || [])].filter(Boolean))).length
                : activeGroup.members.length;

              return (
                <button
                  type="button"
                  onClick={onOpenMembersModal}
                  className="px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-xs sm:text-sm font-bold transition-all flex items-center gap-2 cursor-pointer shadow-2xs active:scale-95 shrink-0"
                  title={`Visualizza Membri di ${activeSubgroup ? activeSubgroup.name : activeGroup.name}`}
                  aria-label={`Membri: ${currentMembersCount}`}
                >
                  <Users className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-[#f23e2e]" />
                  <span className="font-mono font-bold text-xs sm:text-sm">
                    {currentMembersCount}
                  </span>
                </button>
              );
            })()}

            {/* Tasto Elimina (visibile solo a chi è autorizzato) */}
            {canManageCurrent && (activeSubgroup ? Boolean(onDeleteSubgroup) : Boolean(onDeleteGroup)) && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 text-xs font-bold transition-all cursor-pointer shadow-2xs active:scale-95 border border-red-200/50 dark:border-red-900/40 shrink-0"
                title={activeSubgroup ? 'Elimina questo sottogruppo' : 'Elimina questo gruppo'}
                aria-label="Elimina"
              >
                <Trash2 className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modale Conferma Eliminazione Gruppo o Sottogruppo */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-3xl p-6 border border-neutral-200 dark:border-neutral-800 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 stroke-[2.5px]" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-black text-neutral-900 dark:text-white">
                {activeSubgroup ? 'Eliminare il sottogruppo?' : 'Eliminare il gruppo?'}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Sei sicuro di voler eliminare definitivamente{' '}
                <strong>"{activeSubgroup ? activeSubgroup.name : activeGroup.name}"</strong>? L'operazione non può essere annullata.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="flex-1 py-2 px-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 text-xs font-bold transition-all cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-red-600/30 flex items-center justify-center gap-1.5"
              >
                {isDeleting ? (
                  <span>Eliminazione...</span>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{activeSubgroup ? 'Elimina Sottogruppo' : 'Elimina Gruppo'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Modifica / Personalizzazione Completa Gruppo o Sottogruppo (Nome, Icona, Descrizione, Privacy) */}
      {isCustomizeOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-neutral-900 w-full max-w-md rounded-3xl p-6 border border-neutral-200 dark:border-neutral-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-2.5">
                <GroupAvatar
                  avatar={editAvatar}
                  name={editName || (activeSubgroup ? 'Sottogruppo' : 'Gruppo')}
                  size="md"
                  fallbackEmoji={activeSubgroup ? '📁' : '👥'}
                />
                <div>
                  <h3 className="text-base font-black text-neutral-900 dark:text-white">
                    {activeSubgroup ? 'Modifica Sottogruppo' : 'Modifica Gruppo'}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    {activeSubgroup ? `Sottocartella di ${activeGroup.name}` : `Gestione di ${activeGroup.name}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomizeOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomization} className="space-y-4">
              {/* Selezione Icona o Immagine */}
              <div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCustomImageChange}
                  className="hidden"
                />
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Icona o Immagine
                  </label>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="text-[11px] text-purple-600 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" />
                    <span>Carica foto</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {(editAvatar.startsWith('data:image/') || editAvatar.startsWith('http')) && (
                    <div className="relative shrink-0 mr-1">
                      <div className="w-9 h-9 rounded-xl overflow-hidden border-2 border-purple-600 shadow-xs">
                        <img src={editAvatar} alt="Avatar" className="w-full h-full object-cover" />
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditAvatar(activeSubgroup ? '📁' : '👥')}
                        title="Rimuovi foto"
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-800 text-white flex items-center justify-center text-[10px] cursor-pointer hover:bg-red-600"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    title="Carica foto da file"
                    className="w-9 h-9 rounded-xl flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 border border-dashed border-neutral-300 dark:border-neutral-600 cursor-pointer"
                  >
                    <ImageIcon className="w-4 h-4 text-purple-600" />
                  </button>

                  {/* Prime 2 icone visibili subito */}
                  {PRESET_ICONS.slice(0, 2).map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setEditAvatar(icon)}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all cursor-pointer ${
                        editAvatar === icon
                          ? 'bg-purple-100 dark:bg-purple-950/70 border-2 border-purple-600 scale-110 shadow-xs'
                          : 'bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:scale-105'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}

                  {/* Tasto 3 puntini */}
                  {!showAllIcons ? (
                    <>
                      {PRESET_ICONS.slice(2).includes(editAvatar) && (
                        <button
                          type="button"
                          onClick={() => setEditAvatar(editAvatar)}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all cursor-pointer bg-purple-100 dark:bg-purple-950/70 border-2 border-purple-600 scale-110 shadow-xs"
                        >
                          {editAvatar}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowAllIcons(true)}
                        title="Mostra tutte le altre icone"
                        className="w-9 h-9 rounded-xl flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 border border-dashed border-neutral-300 dark:border-neutral-600 transition-all shrink-0 cursor-pointer active:scale-95"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {PRESET_ICONS.slice(2).map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          onClick={() => setEditAvatar(icon)}
                          className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all cursor-pointer ${
                            editAvatar === icon
                              ? 'bg-purple-100 dark:bg-purple-950/70 border-2 border-purple-600 scale-110 shadow-xs'
                              : 'bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:scale-105'
                          }`}
                        >
                          {icon}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowAllIcons(false)}
                        title="Mostra meno icone"
                        className="w-9 h-9 rounded-xl flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 border border-neutral-200 dark:border-neutral-700 transition-all shrink-0 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Selezione Colore Sottogruppo (solo per sottogruppi, con 2/3 visibili e puntini per espandere) */}
              {activeSubgroup && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                      Colore Sottogruppo
                    </label>
                    <span className="text-xs font-bold" style={{ color: editColor }}>
                      {PRESET_COLORS.find((c) => c.hex === editColor)?.label || 'Selezionato'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Primi 3 colori visibili */}
                    {PRESET_COLORS.slice(0, 3).map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setEditColor(c.hex)}
                        title={c.label}
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                          editColor === c.hex
                            ? 'ring-2 ring-offset-2 ring-purple-600 dark:ring-offset-neutral-900 scale-110 shadow-xs'
                            : 'hover:scale-105 opacity-90 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      >
                        {editColor === c.hex && (
                          <Check className="w-4 h-4 text-white stroke-[3px] drop-shadow-xs" />
                        )}
                      </button>
                    ))}

                    {/* Tasto 3 puntini */}
                    {!showAllColors ? (
                      <>
                        {PRESET_COLORS.slice(3).some((c) => c.hex === editColor) && (
                          <button
                            type="button"
                            onClick={() => setEditColor(editColor)}
                            title={PRESET_COLORS.find((c) => c.hex === editColor)?.label}
                            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ring-2 ring-offset-2 ring-purple-600 dark:ring-offset-neutral-900 scale-110 shadow-xs"
                            style={{ backgroundColor: editColor }}
                          >
                            <Check className="w-4 h-4 text-white stroke-[3px] drop-shadow-xs" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowAllColors(true)}
                          title="Mostra tutti i colori"
                          className="w-8 h-8 rounded-xl flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 border border-dashed border-neutral-300 dark:border-neutral-600 transition-all shrink-0 cursor-pointer active:scale-95"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        {PRESET_COLORS.slice(3).map((c) => (
                          <button
                            key={c.hex}
                            type="button"
                            onClick={() => setEditColor(c.hex)}
                            title={c.label}
                            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                              editColor === c.hex
                                ? 'ring-2 ring-offset-2 ring-purple-600 dark:ring-offset-neutral-900 scale-110 shadow-xs'
                                : 'hover:scale-105 opacity-90 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: c.hex }}
                          >
                            {editColor === c.hex && (
                              <Check className="w-4 h-4 text-white stroke-[3px] drop-shadow-xs" />
                            )}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setShowAllColors(false)}
                          title="Mostra meno"
                          className="w-8 h-8 rounded-xl flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 border border-neutral-200 dark:border-neutral-700 transition-all shrink-0 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                  {activeSubgroup ? 'Nome Sottogruppo *' : 'Nome Gruppo *'}
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                />
              </div>

              {/* Descrizione */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                  Descrizione (Opzionale)
                </label>
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder={activeSubgroup ? "Scopo e mansioni di questa sottocartella" : "Descrizione del gruppo di lavoro"}
                  className="w-full px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 resize-none"
                />
              </div>

              {/* Privacy: Pubblico vs Privato */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                  Visibilità e Accesso
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditIsPublic(false)}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      !editIsPublic
                        ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-500 shadow-xs'
                        : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    <span className="text-xs font-black text-neutral-900 dark:text-white block">
                      🔒 Privato
                    </span>
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400 block mt-0.5">
                      Richiede codice d'accesso univoco
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditIsPublic(true)}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      editIsPublic
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 shadow-xs'
                        : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    <span className="text-xs font-black text-neutral-900 dark:text-white block">
                      🌐 Pubblico
                    </span>
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400 block mt-0.5">
                      Aperto a tutti i membri del gruppo
                    </span>
                  </button>
                </div>
              </div>

              {/* Tasti Azione */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsCustomizeOpen(false)}
                  disabled={isSavingCustomization}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isSavingCustomization || !editName.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSavingCustomization ? 'Salvataggio...' : 'Salva Modifiche'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
