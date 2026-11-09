/**
 * JESic Meet - Pagina Pubblica Termini e Condizioni di Servizio
 * Junior Enterprise Sicilia
 * 
 * Conforme ai requisiti di trasparenza Google OAuth e regolamentazione associativa.
 */

import React from 'react';
import {
  FileText,
  ArrowLeft,
  Calendar,
  Shield,
  CheckCircle2,
  Users,
  AlertTriangle,
  Mail,
  Scale,
} from 'lucide-react';

interface TermsOfServiceViewProps {
  onBackToApp: () => void;
}

export const TermsOfServiceView: React.FC<TermsOfServiceViewProps> = ({ onBackToApp }) => {
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
                Termini e Condizioni di Utilizzo della Piattaforma
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
              <Scale className="w-3.5 h-3.5 text-[#f23e2e]" />
              <span>Condizioni di Utilizzo della Piattaforma & Regolamento di Servizio</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Termini e Condizioni di Servizio
            </h1>
            <p className="text-xs sm:text-sm text-neutral-300 max-w-2xl leading-relaxed">
              I presenti Termini e Condizioni disciplinano l&apos;accesso e l&apos;utilizzo della piattaforma <strong>JESic Meet</strong> da parte di membri, collaboratori, partner e interlocutori esterni di <strong>Junior Enterprise Sicilia</strong>.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-4 text-[11px] text-neutral-400">
              <span>Data di efficacia: <strong>9 Novembre 2026</strong></span>
              <span>•</span>
              <span>Ultima revisione: <strong>9 Novembre 2026</strong></span>
              <span>•</span>
              <span>Ambito: <strong>Uso Associativo e Organizzativo</strong></span>
            </div>
          </div>
        </div>

        {/* Corpo dei Termini e Condizioni */}
        <div className="bg-white dark:bg-neutral-900 rounded-3xl p-6 sm:p-8 border border-neutral-200 dark:border-neutral-800 shadow-sm space-y-8 text-neutral-700 dark:text-neutral-300 text-xs sm:text-sm leading-relaxed">

          {/* Articolo 1: Accettazione dei Termini */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">1</span>
              Ambito di Applicazione e Accettazione dei Termini
            </h2>
            <p>
              L&apos;accesso, la registrazione e l&apos;uso di JESic Meet implicano l&apos;accettazione dei presenti Termini e Condizioni di Servizio. L&apos;utente che non intenda accettare le presenti clausole è tenuto a non utilizzare la piattaforma.
            </p>
            <p>
              Si precisa che l&apos;accettazione dei presenti Termini disciplina esclusivamente il rapporto contrattuale di utilizzo della piattaforma e va tenuta distinta:
            </p>
            <ul className="space-y-1.5 pl-4 list-disc text-xs sm:text-sm">
              <li>
                Dall&apos;<strong>Informativa sulla Privacy:</strong> il trattamento dei dati personali è regolato in via autonoma dalla specifica{' '}
                <a href="/privacy" className="text-[#f23e2e] underline font-semibold hover:text-red-700">
                  Informativa sulla Privacy
                </a>{' '}
                resa ai sensi del Regolamento UE 2016/679 (GDPR).
              </li>
              <li>
                Dall&apos;<strong>Autorizzazione Google OAuth:</strong> la concessione dei permessi per la sincronizzazione del calendario è un passaggio del tutto facoltativo, gestito tramite l&apos;apposita schermata di autorizzazione di Google e revocabile in qualunque momento.
              </li>
            </ul>
          </section>

          {/* Articolo 2: Descrizione del Servizio */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">2</span>
              Natura e Funzionalità della Piattaforma
            </h2>
            <p>
              <strong>JESic Meet</strong> è uno strumento software sviluppato per agevolare il coordinamento organizzativo interno e la pianificazione degli incontri di Junior Enterprise Sicilia. Le sue funzionalità comprendono:
            </p>
            <ul className="space-y-1.5 pl-4 list-disc text-xs sm:text-sm">
              <li><strong>Spazi di lavoro e gruppi:</strong> organizzazione delle attività in gruppi e sottogruppi tematici, con gestione di ruoli operativi, codici di invito e link dedicati.</li>
              <li><strong>Sondaggi di disponibilità oraria:</strong> rilevazione delle fasce orarie disponibili dei partecipanti mediante griglia interattiva interna per calcolare gli orari ottimali di riunione.</li>
              <li><strong>Messaggistica e scambio file:</strong> canali di chat interna di gruppo e sottogruppo per comunicazioni operative, note vocali e condivisione di allegati.</li>
              <li><strong>Sincronizzazione opzionale con Google Calendar:</strong> inserimento, aggiornamento o cancellazione degli eventi confermati nel calendario dell&apos;utente e creazione automatica del link alla riunione Google Meet.</li>
              <li><strong>Modulo pubblico di prenotazione (B2B):</strong> ricezione e gestione di richieste di contatto e riunioni inviate da clienti, partner o aziende esterne (/prenota-call).</li>
            </ul>
          </section>

          {/* Articolo 3: Account e Credenziali */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">3</span>
              Account Personale e Responsabilità dell&apos;Utente
            </h2>
            <p>
              L&apos;utente è tenuto a custodire con diligenza le credenziali di accesso al proprio account e risponde di tutte le attività compiute attraverso il proprio profilo. L&apos;utente si impegna a fornire informazioni veritiere e ad astenersi dal creare account con identità fittizie, impersonare altri soggetti o cedere le credenziali a terzi. In caso di sospetto accesso non autorizzato, l&apos;utente è invitato a darne immediata comunicazione all&apos;assistenza.
            </p>
          </section>

          {/* Articolo 4: Integrazione con le API di Google */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">4</span>
              Integrazione con Google Calendar (Facoltativa)
            </h2>
            <p>
              L&apos;integrazione con Google Calendar è una funzionalità <strong>del tutto facoltativa</strong>. La mancata connessione a Google Calendar non impedisce all&apos;utente di accedere a JESic Meet, partecipare ai gruppi di lavoro, compilare i sondaggi di disponibilità o utilizzare i canali di chat.
            </p>
            <p>
              Qualora l&apos;utente decida di abilitare la sincronizzazione, autorizza l&apos;applicazione a operare tramite le API di Google Calendar unicamente per inserire, modificare o eliminare gli eventi confermati delle riunioni a cui partecipa. L&apos;utente può disconnettere il calendario in qualsiasi momento dal profilo o revocare i permessi dalle impostazioni di sicurezza dell&apos;account Google.
            </p>
            <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs space-y-1.5">
              <p className="font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-[#f23e2e]" />
                Dichiarazione Google Workspace Limited Use
              </p>
              <p className="text-neutral-700 dark:text-neutral-300 font-semibold italic">
                &ldquo;The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements.&rdquo;
              </p>
              <p className="text-neutral-600 dark:text-neutral-400 text-[11px]">
                (Traduzione: &ldquo;L&apos;uso delle informazioni ricevute dagli scope di Google Workspace rispetterà le Norme sui dati utente dei servizi API di Google, inclusi i requisiti di Uso Limitato&rdquo;). I dati Google non vengono ceduti a terzi per scopi promozionali né usati per finalità estranee alla gestione delle riunioni.
              </p>
            </div>
          </section>

          {/* Articolo 5: Condotta dell'Utente */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">5</span>
              Regole di Condotta e Utilizzo Accettabile
            </h2>
            <p>
              L&apos;utente si impegna a utilizzare JESic Meet in modo corretto, rispettoso e conforme alla legge e ai regolamenti associativi. È severamente vietato:
            </p>
            <ul className="space-y-1.5 pl-4 list-disc text-xs sm:text-sm">
              <li>Utilizzare la piattaforma per scopi illeciti, diffamatori, molesti o contrari all&apos;ordine pubblico.</li>
              <li>Diffondere materiale non autorizzato, comunicazioni promozionali indesiderate (spam) o compiere tentativi di phishing.</li>
              <li>Caricare file o messaggi contenenti virus, malware o codice finalizzato a danneggiare sistemi o dispositivi di altri utenti.</li>
              <li>Tentare di aggirare le misure di autenticazione o di sicurezza, accedere a dati di altri gruppi senza autorizzazione o manomettere server e database.</li>
              <li>Compiere attività di reverse engineering, scraping automatizzato o sovraccaricare deliberatamente l&apos;infrastruttura di servizio.</li>
            </ul>
          </section>

          {/* Articolo 6: Proprietà Intellettuale */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">6</span>
              Proprietà Intellettuale
            </h2>
            <p>
              Tutti i diritti di proprietà industriale e intellettuale relativi alla denominazione JESic Meet, ai loghi, alla grafica, ai testi dell&apos;interfaccia e al codice sorgente appartengono a <strong>Junior Enterprise Sicilia</strong> o sono concessi in licenza d&apos;uso. All&apos;utente è concessa esclusivamente una licenza d&apos;uso limitata, non esclusiva e non cedibile, finalizzata alla normale fruizione del servizio.
            </p>
          </section>

          {/* Articolo 7: Limitazione di Responsabilità */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">7</span>
              Disponibilità del Servizio e Limitazione di Responsabilità
            </h2>
            <p>
              La piattaforma viene erogata con l&apos;adozione di misure tecniche idonee ad assicurarne la sicurezza e la continuità per le finalità associative e operative.
            </p>
            <p>
              Fatti salvi i limiti inderogabili stabiliti dalla legge e i diritti che la normativa applicabile riconosce all&apos;utente, Junior Enterprise Sicilia non assume responsabilità per disservizi, ritardi o interruzioni derivanti da cause di forza maggiore, malfunzionamenti delle reti telematiche o temporanee indisponibilità imputabili a piattaforme di terze parti (quali le API Google o i provider dell&apos;infrastruttura di hosting).
            </p>
          </section>

          {/* Articolo 8: Modifiche ai Termini */}
          <section className="space-y-2">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">8</span>
              Modifiche ai Termini di Servizio
            </h2>
            <p>
              Junior Enterprise Sicilia si riserva il diritto di aggiornare o revisionare i presenti Termini per adeguarli a novità legislative, miglioramenti tecnici o modifiche ai servizi offerti. Le versioni aggiornate saranno pubblicate tempestivamente in questa pagina con l&apos;indicazione della data di revisione. L&apos;uso continuato della piattaforma a seguito della pubblicazione delle modifiche costituisce accettazione dei Termini aggiornati.
            </p>
          </section>

          {/* Articolo 9: Legge Applicabile e Contatti */}
          <section className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <h2 className="text-base sm:text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-bold text-[#f23e2e]">9</span>
              Legge Applicabile, Foro Competente e Assistenza
            </h2>
            <p>
              I presenti Termini sono disciplinati dalla legge italiana. Per qualsiasi controversia relativa all&apos;interpretazione, validità o esecuzione del servizio sarà competente il Tribunale di Palermo, fatte salve eventuali disposizioni di legge inderogabili applicabili.
            </p>
            <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs space-y-1">
              <p className="font-bold text-neutral-900 dark:text-white">JESic - Junior Enterprise Sicilia (Associazione studentesca)</p>
              <p>Partita IVA: IT06729850823</p>
              <p>Sede legale: Via F. Tocco 41, 90086 Montelepre (PA), Italia</p>
              <p>Presidente e Legale Rappresentante: Gaia Federico</p>
              <p className="flex items-center gap-1.5 pt-1">
                <Mail className="w-3.5 h-3.5 text-[#f23e2e]" />
                <span>Recapito di assistenza e comunicazioni: </span>
                <a href="mailto:info@jesic.it" className="font-semibold text-[#f23e2e] hover:underline">
                  info@jesic.it
                </a>
              </p>
            </div>
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
