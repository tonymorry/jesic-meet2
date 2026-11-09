/**
 * JESic Meet - Pagina Pubblica Privacy Policy
 * Junior Enterprise Sicilia
 * 
 * Conforme ai requisiti di verifica Google OAuth (Google Cloud Console)
 * e al Regolamento Generale sulla Protezione dei Dati (GDPR - UE 2016/679).
 */

import React from 'react';
import {
  Shield,
  ArrowLeft,
  Calendar,
  Lock,
  EyeOff,
  CheckCircle2,
  ExternalLink,
  Mail,
  FileText,
  AlertCircle,
  Database,
  Trash2,
} from 'lucide-react';

interface PrivacyPolicyViewProps {
  onBackToApp: () => void;
}

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onBackToApp }) => {
  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-black font-['Ubuntu',sans-serif] text-neutral-900 dark:text-neutral-100 antialiased py-8 px-4 sm:px-6 lg:px-8 selection:bg-[#f23e2e] selection:text-white transition-colors">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Barra di Navigazione Superiore */}
        <div className="bg-white dark:bg-neutral-900 rounded-3xl p-4 sm:p-5 border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white p-1.5 flex items-center justify-center shadow-md border border-neutral-200/80 shrink-0">
              <img src="/logo.png" alt="JESic Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-black tracking-tight text-neutral-900 dark:text-white">
                  JESic<span className="text-[#f23e2e]">Meet</span>
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-100 dark:bg-red-950/60 text-[#f23e2e] border border-red-200 dark:border-red-900">
                  Ufficiale
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Informativa sulla Privacy & Protezione Dati
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onBackToApp}
            className="w-full sm:w-auto px-4 py-2.5 rounded-2xl bg-[#f23e2e] hover:bg-red-600 text-white text-xs font-bold transition-all shadow-md shadow-red-600/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Torna alla Home</span>
          </button>
        </div>

        {/* Intestazione del Documento */}
        <div className="bg-gradient-to-br from-[#1e1e1e] via-[#242424] to-[#151515] text-white rounded-3xl p-6 sm:p-8 border border-neutral-800 shadow-xl relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-56 h-56 bg-[#f23e2e]/20 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative z-10 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-semibold backdrop-blur-xs border border-white/15">
              <Shield className="w-3.5 h-3.5 text-[#f23e2e]" />
              <span>Informativa Privacy ai sensi del Regolamento UE 2016/679 (GDPR) e Google User Data Policy</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Informativa sulla Privacy (Privacy Policy)
            </h1>
            <p className="text-xs sm:text-sm text-neutral-300 max-w-2xl leading-relaxed">
              La presente informativa descrive con trasparenza come <strong>JESic Meet</strong> raccoglie, tratta e protegge i dati personali degli utenti e le informazioni di <strong>Google Calendar</strong> a tutela dei membri dell&apos;associazione e degli interlocutori esterni di Junior Enterprise Sicilia.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-4 text-[11px] text-neutral-400">
              <span>Data di entrata in vigore: <strong>9 Novembre 2026</strong></span>
              <span>•</span>
              <span>Ultimo aggiornamento: <strong>9 Novembre 2026</strong></span>
              <span>•</span>
              <span>Stato: <strong>Versione Ufficiale</strong></span>
            </div>
          </div>
        </div>

        {/* BOX DI CONFORMITÀ GOOGLE - LIMITED USE DISCLOSURE */}
        <div className="bg-white dark:bg-neutral-900 rounded-3xl p-6 sm:p-7 border-2 border-[#f23e2e] shadow-lg space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/80 text-[#f23e2e] flex items-center justify-center shrink-0 border border-red-200 dark:border-red-900">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white">
                Clausola Google API Services e Requisiti di Uso Limitato (Limited Use)
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Informativa sull&apos;uso delle informazioni ricevute dalle API di Google in conformità alle norme per i dati utente.
              </p>
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-red-50/70 dark:bg-red-950/40 border border-red-200/80 dark:border-red-900/60 space-y-3">
            <div>
              <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider mb-1">
                Official English Disclosure:
              </p>
              <blockquote className="text-xs sm:text-sm font-semibold text-neutral-800 dark:text-neutral-200 italic leading-relaxed pl-3 border-l-2 border-[#f23e2e]">
                &ldquo;The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements.&rdquo;
              </blockquote>
            </div>

            <div className="pt-2 border-t border-red-200/60 dark:border-red-900/40">
              <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider mb-1">
                Traduzione in Lingua Italiana:
              </p>
              <blockquote className="text-xs sm:text-sm font-semibold text-neutral-800 dark:text-neutral-200 italic leading-relaxed pl-3 border-l-2 border-[#f23e2e]">
                &ldquo;L&apos;uso delle informazioni ricevute dagli scope di Google Workspace rispetterà le Norme sui dati utente dei servizi API di Google (Google User Data Policy), inclusi i requisiti di Uso Limitato (Limited Use).&rdquo;
              </blockquote>
            </div>
          </div>
        </div>

        {/* Corpo della Privacy Policy */}
        <div className="bg-white dark:bg-neutral-900 rounded-3xl p-6 sm:p-8 border border-neutral-200 dark:border-neutral-800 shadow-sm space-y-8 text-neutral-700 dark:text-neutral-300 text-xs sm:text-sm leading-relaxed">

          {/* Sezione 1: Titolare del Trattamento */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">1</span>
              Titolare del Trattamento dei Dati
            </h2>
            <p>
              Il Titolare del trattamento dei dati personali raccolti tramite la piattaforma JESic Meet è:
            </p>
            <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs space-y-1">
              <p className="font-bold text-neutral-900 dark:text-white">JESic - Junior Enterprise Sicilia</p>
              <p>Forma giuridica: Associazione studentesca</p>
              <p>Partita IVA: IT06729850823</p>
              <p>Sede legale: Via F. Tocco 41, 90086 Montelepre (PA), Italia</p>
              <p>Presidente e Legale Rappresentante: Gaia Federico</p>
              <p className="flex items-center gap-1.5 pt-1">
                <Mail className="w-3.5 h-3.5 text-[#f23e2e]" />
                <span>Email pubblica di contatto per assistenza e privacy: </span>
                <a href="mailto:info@jesic.it" className="font-semibold text-[#f23e2e] hover:underline">
                  info@jesic.it
                </a>
              </p>
            </div>
          </section>

          {/* Sezione 2: Scopo dell'Applicazione */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">2</span>
              Finalità del Trattamento e Servizi di JESic Meet
            </h2>
            <p>
              <strong>JESic Meet</strong> è una piattaforma applicativa per la gestione operativa e organizzativa delle attività di Junior Enterprise Sicilia. I dati personali degli utenti vengono trattati per le seguenti finalità:
            </p>
            <ul className="space-y-1.5 pl-4 list-disc text-xs sm:text-sm">
              <li><strong>Gestione degli account e dell&apos;accesso:</strong> registrazione dell&apos;utente, autenticazione con credenziali o Google OAuth, gestione del profilo e attribuzione dei ruoli operativi (membro, responsabile, admin, admin clienti).</li>
              <li><strong>Coordinamento dei gruppi di lavoro:</strong> organizzazione interna delle attività in gruppi e sottogruppi, condivisione di comunicazioni operative e documenti nelle chat dedicate.</li>
              <li><strong>Pianificazione delle riunioni (sondaggi di disponibilità):</strong> raccolta delle disponibilità orarie fornite dai partecipanti tramite una griglia interattiva interna per individuare la fascia oraria ottimale di incontro.</li>
              <li><strong>Sincronizzazione opzionale con Google Calendar:</strong> inserimento, modifica o rimozione automatica delle riunioni confermate nel calendario Google dell&apos;utente e generazione del link alla videochiamata Google Meet, esclusivamente qualora l&apos;utente attivi la relativa funzione.</li>
              <li><strong>Gestione delle richieste di contatto esterne (B2B):</strong> ricezione e gestione delle richieste di incontro inviate da aziende, partner o clienti attraverso il modulo pubblico di prenotazione call (/prenota-call).</li>
            </ul>
          </section>

          {/* Sezione 3: Uso di Google Calendar */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">3</span>
              Integrazione con Google Calendar e Trattamento dei Dati
            </h2>
            <p>
              L&apos;integrazione con Google Calendar è <strong>facoltativa</strong>: l&apos;utente può utilizzare le funzionalità principali di JESic Meet (gruppi, sondaggi, chat) anche senza connettere il proprio account Google Calendar.
            </p>
            <p>
              Qualora l&apos;utente scelga di attivare la sincronizzazione, JESic Meet richiede l&apos;autorizzazione esplicita tramite Google OAuth 2.0 per accedere al seguente scope:
            </p>
            <div className="p-3 rounded-xl bg-neutral-900 text-neutral-100 font-mono text-xs border border-neutral-800 overflow-x-auto">
              https://www.googleapis.com/auth/calendar.events
            </div>
            <p className="font-semibold text-neutral-900 dark:text-white">
              Le operazioni effettivamente svolte da JESic Meet tramite le API di Google Calendar sono:
            </p>
            <ul className="space-y-2 pl-4 list-disc text-xs sm:text-sm">
              <li>
                <strong>Creazione di eventi concordati:</strong> inserimento dell&apos;evento confermato nel calendario Google personale dell&apos;utente con orario di inizio, fine, titolo, descrizione della riunione, partecipanti e link alla videochiamata Google Meet.
              </li>
              <li>
                <strong>Aggiornamento di eventi esistenti:</strong> modifica dei dettagli o degli orari nel calendario Google qualora una riunione già confermata venga riprogrammata o modificata su JESic Meet dagli organizzatori.
              </li>
              <li>
                <strong>Cancellazione di eventi:</strong> eliminazione dell&apos;evento dal calendario Google qualora la riunione venga annullata o eliminata su JESic Meet.
              </li>
              <li>
                <strong>Modalità di calcolo delle disponibilità:</strong> si precisa che la rilevazione delle fasce orarie disponibili avviene mediante compilazione diretta da parte dei membri all&apos;interno della griglia oraria dell&apos;applicazione, e non tramite scansione continuativa o lettura massiva degli eventi personali presenti nell&apos;agenda Google dell&apos;utente.
              </li>
            </ul>

            {/* Limiti e impegni sui dati Google */}
            <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 text-xs space-y-2">
              <p className="font-black flex items-center gap-1.5 text-neutral-900 dark:text-white">
                <CheckCircle2 className="w-4 h-4 text-[#f23e2e]" />
                Limiti e Impegni sul Trattamento dei Dati Google Calendar:
              </p>
              <ul className="space-y-1.5 pl-4 list-disc text-[11px] sm:text-xs text-neutral-600 dark:text-neutral-300">
                <li><strong>Nessuna vendita di dati:</strong> i dati ottenuti dalle API di Google non vengono venduti, concessi in locazione o ceduti a terze parti, broker di dati o intermediari commerciali.</li>
                <li><strong>Nessun uso pubblicitario o di profilazione:</strong> le informazioni relative alle riunioni non vengono utilizzate per scopi di pubblicità personalizzata, marketing mirato o profilazione degli utenti.</li>
                <li><strong>Nessun addestramento di intelligenze artificiali generaliste:</strong> i dati delle riunioni non vengono utilizzati per l&apos;addestramento di modelli di machine learning o intelligenza artificiale generalisti o di terze parti.</li>
                <li><strong>Trattamento tecnico da parte dei fornitori di servizio:</strong> i dati sono trattati esclusivamente per le funzioni operative richieste dall&apos;utente e possono essere elaborati da fornitori tecnici strettamente necessari all&apos;erogazione del servizio (es. hosting), soggetti a vincoli contrattuali di riservatezza e sicurezza, senza alcuna cessione commerciale indipendente.</li>
              </ul>
            </div>
          </section>

          {/* Sezione 4: Tipologia di Dati Trattati */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">4</span>
              Categorie di Dati Personali Trattati
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 space-y-1">
                <p className="font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#f23e2e]" />
                  Dati di Profilo e Accesso
                </p>
                <p className="text-neutral-500 dark:text-neutral-400 text-[11px]">
                  Nome, cognome, indirizzo email aziendale o personale fornito in registrazione, credenziali di accesso protette da hashing crittografico (o credenziali Google OAuth), eventuale immagine di profilo caricata, identificativi di sessione e token autorizzativi per Google Calendar se collegato.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 space-y-1">
                <p className="font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-[#f23e2e]" />
                  Dati Organizzativi e di Attività
                </p>
                <p className="text-neutral-500 dark:text-neutral-400 text-[11px]">
                  Gruppi e sottogruppi di appartenenza, ruolo all&apos;interno del gruppo (membro, responsabile, admin, admin clienti), disponibilità orarie indicate nei sondaggi interni e titoli delle riunioni.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 space-y-1 sm:col-span-2">
                <p className="font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-[#f23e2e]" />
                  Messaggi di Chat e Richieste Esterne (B2B)
                </p>
                <p className="text-neutral-500 dark:text-neutral-400 text-[11px]">
                  Testi, immagini, note vocali e file scambiati all&apos;interno delle chat di gruppo per finalità operative; per i soggetti esterni che compilano il modulo /prenota-call: nome del referente, azienda o organizzazione, indirizzo email, argomento della richiesta e disponibilità orarie proposte.
                </p>
              </div>
            </div>
          </section>

          {/* Sezione 5: Sicurezza e Archiviazione */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">5</span>
              Sicurezza, Conservazione e Destinatari dei Dati
            </h2>
            <p>
              I dati vengono trattati con misure tecniche e organizzative adeguate a prevenire accessi non autorizzati, divulgazioni o alterazioni. Tutte le comunicazioni tra il browser dell&apos;utente e il server avvengono su canale protetto tramite protocollo HTTPS (TLS). Le credenziali di accesso sono protette mediante funzioni di hashing.
            </p>
            <div className="space-y-2 text-xs">
              <p>
                <strong>Infrastruttura e localizzazione:</strong> I servizi applicativi e il backend di JESic Meet sono ospitati sulla piattaforma cloud <strong>Render</strong>. La base di dati è gestita tramite <strong>MongoDB Atlas</strong>, con cluster e dati archiviati all&apos;interno dell&apos;Unione Europea (regione Europa).
              </p>
              <p>
                <strong>Periodo di conservazione dei dati e logiche di eliminazione:</strong>
              </p>
              <ul className="pl-4 list-disc space-y-1 text-neutral-600 dark:text-neutral-400">
                <li>I dati di account e di profilo rimangono conservati per la durata dell&apos;attività associativa o operativa dell&apos;utente, fino alla cancellazione dell&apos;account.</li>
                <li>I messaggi delle chat di gruppo vengono eliminati automaticamente dopo 50 giorni di vita; i file multimediali pesanti (foto e note vocali) vengono ripuliti in automatico dopo 20 giorni dall&apos;invio per contenere l&apos;occupazione di memoria.</li>
                <li>Gli eventi e gli impegni del calendario già conclusi da più di 30 giorni (e le relative risposte espresse dai partecipanti) vengono cancellati definitivamente dal database mediante procedura automatica di pulizia periodica; le registrazioni di notifica push obsolete vengono eliminate dopo 60 giorni.</li>
                <li>I log applicativi generati su Render vengono conservati per 7 giorni (in base al piano Hobby, o secondo il periodo previsto dal piano del workspace di deployment); i log tecnici di diagnostica e sicurezza su MongoDB Atlas vengono conservati fino a 30 giorni.</li>
              </ul>
              <p>
                <strong>Trasferimenti internazionali:</strong> L&apos;infrastruttura principale e i database sono configurati all&apos;interno dello Spazio Economico Europeo (SEE). Qualora fornitori tecnici o sub-responsabili (tra cui Google LLC per le relative API o Render/MongoDB per le infrastrutture globali di supporto) trattino dati al di fuori del SEE, tali trasferimenti avvengono sulla base di Clausole Contrattuali Tipo (SCC) adottate dalla Commissione Europea e/o in virtù dell&apos;adesione all&apos;EU-U.S. Data Privacy Framework.
              </p>
              <p>
                <strong>Destinatari dei dati:</strong> I dati personali non vengono mai venduti o ceduti a terze parti a scopo pubblicitario. Possono accedervi esclusivamente i membri incaricati di Junior Enterprise Sicilia (in relazione al proprio ruolo) e i fornitori di servizi tecnologici strettamente necessari all&apos;erogazione della piattaforma (Render per l&apos;hosting, MongoDB Atlas per il database, Google LLC per le relative API autorizzate).
              </p>
            </div>
          </section>

          {/* Sezione 6: Revoca del Consenso e Cancellazione */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">6</span>
              Revoca dei Permessi e Cancellazione dei Dati
            </h2>
            <p>
              L&apos;utente ha la facoltà di interrompere o gestire l&apos;accesso ai propri dati in qualsiasi momento:
            </p>
            <ul className="space-y-2 pl-4 list-disc text-xs sm:text-sm">
              <li>
                <strong>Disconnessione dall&apos;applicazione:</strong> È possibile scollegare Google Calendar direttamente dalla sezione Profilo dell&apos;applicazione.
              </li>
              <li>
                <strong>Revoca dei permessi da Google:</strong> È possibile revocare l&apos;autorizzazione concessa a JESic Meet in qualsiasi momento dalla pagina di sicurezza del proprio account Google:{' '}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#f23e2e] underline hover:text-red-700 font-semibold inline-flex items-center gap-0.5"
                >
                  myaccount.google.com/permissions
                  <ExternalLink className="w-3 h-3 ml-0.5" />
                </a>.
              </li>
              <li>
                <strong>Cancellazione dell&apos;account e dei dati:</strong> L&apos;utente può richiedere la cancellazione del proprio account e dei dati personali inviando una comunicazione a{' '}
                <a href="mailto:info@jesic.it" className="text-[#f23e2e] underline font-semibold">
                  info@jesic.it
                </a>. La richiesta viene gestita secondo i tempi standard previsti dalla normativa, entro 30 giorni dalla ricezione.
              </li>
            </ul>
          </section>

          {/* Sezione 7: Diritti dell'Interessato (GDPR) */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">7</span>
              Diritti dell&apos;Interessato (Artt. 15-22 GDPR)
            </h2>
            <p>
              In conformità al Regolamento UE 2016/679 (GDPR), ogni interessato ha il diritto di:
            </p>
            <ul className="space-y-1.5 pl-4 list-disc text-xs sm:text-sm">
              <li>Richiedere l&apos;accesso ai propri dati personali e riceverne copia;</li>
              <li>Chiedere la rettifica dei dati inesatti o l&apos;integrazione di quelli incompleti;</li>
              <li>Richiedere la cancellazione dei dati nei casi previsti dall&apos;art. 17 GDPR;</li>
              <li>Chiedere la limitazione del trattamento nelle ipotesi contemplate dall&apos;art. 18 GDPR;</li>
              <li>Opporsi al trattamento dei dati per motivi connessi alla propria situazione particolare;</li>
              <li>Richiedere la portabilità dei dati personali forniti, ove applicabile;</li>
              <li>Revocare in qualsiasi momento il consenso eventualmente prestato, senza pregiudicare la liceità del trattamento anteriore alla revoca;</li>
              <li>Proporre reclamo all&apos;autorità di controllo competente (per l&apos;Italia: Garante per la Protezione dei Dati Personali, www.garanteprivacy.it).</li>
            </ul>
          </section>

          {/* Sezione 8: Contatti Ufficiali */}
          <section className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">8</span>
              Domande e Contatti
            </h2>
            <p>
              Per informazioni, chiarimenti sull&apos;Informativa sulla Privacy o per l&apos;esercizio dei diritti in materia di protezione dei dati, è possibile rivolgersi al Titolare del trattamento all&apos;indirizzo di posta elettronica:
            </p>
            <p className="font-bold text-[#f23e2e] text-sm">
              <a href="mailto:info@jesic.it" className="hover:underline">
                info@jesic.it
              </a>
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              JESic - Junior Enterprise Sicilia (Associazione studentesca) • Partita IVA IT06729850823 • Sede: Via F. Tocco 41, 90086 Montelepre (PA) • Presidente: Gaia Federico
            </p>
          </section>

        </div>

        {/* Footer Pagina con Pulsante Home */}
        <div className="bg-white dark:bg-neutral-900 rounded-3xl p-5 border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500 dark:text-neutral-400">
          <p>© 2026 Junior Enterprise Sicilia (JESic) • Tutti i diritti riservati</p>
          <button
            type="button"
            onClick={onBackToApp}
            className="px-5 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white font-bold transition-all flex items-center gap-2 cursor-pointer active:scale-95"
          >
            <ArrowLeft className="w-4 h-4 text-[#f23e2e]" />
            <span>Torna alla Schermata di Accesso</span>
          </button>
        </div>

      </div>
    </div>
  );
};
