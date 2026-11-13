import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Command, Compass, Hash, Menu, RotateCw, Search, Shield, ShieldCheck, ShieldX, Users, X } from 'lucide-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  getGetBotOverviewQueryKey,
  getHealthCheckQueryKey,
  useGetBotOverview,
  useHealthCheck,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const BOT_PERMISSIONS = '1099914374166';

function getBotInviteUrl(applicationId: string | null) {
  if (!applicationId) return null;
  const params = new URLSearchParams({
    client_id: applicationId,
    permissions: BOT_PERMISSIONS,
    scope: 'bot applications.commands',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

const categoryTranslations: Record<string, string> = {
  moderation: 'الإشراف',
  mod: 'الإشراف',
  admin: 'الإدارة',
  administration: 'الإدارة',
  setup: 'الإعداد',
  utility: 'الأدوات',
  utilities: 'الأدوات',
  general: 'عام',
  information: 'المعلومات',
  info: 'المعلومات',
  community: 'المجتمع',
  automod: 'الإشراف التلقائي',
  'auto moderation': 'الإشراف التلقائي',
  fun: 'الترفيه',
  other: 'أخرى',
};

const commandDescriptions: Record<string, string> = {
  ban: 'حظر عضو من الخادم.',
  unban: 'إلغاء حظر عضو من الخادم.',
  kick: 'طرد عضو من الخادم.',
  warn: 'إرسال تحذير إلى عضو.',
  timeout: 'تقييد عضو مؤقتًا.',
  mute: 'كتم عضو.',
  unmute: 'إلغاء كتم عضو.',
  purge: 'حذف مجموعة من الرسائل.',
  clear: 'حذف مجموعة من الرسائل.',
  slowmode: 'ضبط وضع الإبطاء للقناة.',
  lock: 'قفل القناة أمام الأعضاء.',
  unlock: 'فتح القناة أمام الأعضاء.',
  setup: 'إعداد صلاحيات الإشراف وخيارات البوت لهذا الخادم.',
  help: 'عرض المساعدة والأوامر المتاحة.',
  ping: 'عرض حالة استجابة البوت.',
  report: 'إرسال بلاغ إلى فريق الإشراف.',
  userinfo: 'عرض معلومات العضو.',
  serverinfo: 'عرض معلومات الخادم.',
};

function localizeCategory(category: string) {
  if (/[\u0600-\u06FF]/.test(category)) return category;
  const normalized = category.trim().toLowerCase();
  return categoryTranslations[normalized] ?? Object.entries(categoryTranslations).find(([source]) => normalized.includes(source))?.[1] ?? 'أخرى';
}

function localizeCommandDescription(name: string, description: string, category: string) {
  if (/[\u0600-\u06FF]/.test(description)) return description;
  const key = name.trim().toLowerCase().replace(/^\/+/, '').split(/\s+/)[0];
  return commandDescriptions[key] ?? `أمر ${name} ضمن فئة ${localizeCategory(category)}. راجع تفاصيل استخدامه في Discord.`;
}

function localizeRuntimeStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (['ok', 'healthy', 'online', 'connected', 'up'].includes(normalized)) return 'يعمل';
  if (['error', 'down', 'offline', 'unhealthy', 'disconnected'].includes(normalized)) return 'متوقف';
  return 'غير متاح';
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    { href: '/', label: 'نظرة عامة', icon: Compass },
    { href: '/commands', label: 'الأوامر', icon: Command },
  ];

  return (
    <div className="grain min-h-[100dvh]">
      <header className="relative z-10 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] backdrop-blur-md">
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" className="group flex items-center gap-3" data-testid="link-brand">
            <span className="grid h-10 w-10 place-items-center rounded-[13px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
              <Shield size={19} strokeWidth={1.8} />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-[-.035em]">بوت الإشراف</span>
              <span className="mono-face mt-1 block text-[9px] tracking-[.12em] text-muted-foreground">مركز تحكم Discord</span>
            </span>
          </Link>
          <button className="grid h-10 w-10 place-items-center rounded-xl border border-border text-foreground md:hidden" aria-label="تبديل التنقل" onClick={() => setMenuOpen(!menuOpen)} data-testid="button-navigation-menu">
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <nav aria-label="التنقل الرئيسي" className={`${menuOpen ? 'absolute left-0 right-0 top-[75px] flex border-b border-border bg-background px-5 py-3 shadow-lg' : 'hidden'} md:static md:flex md:items-center md:gap-2 md:border-0 md:bg-transparent md:p-0 md:shadow-none`}>
            {links.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium transition-colors ${location === href ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'}`} data-testid={`link-nav-${href === '/' ? 'overview' : 'commands'}`}>
                <Icon size={15} strokeWidth={1.8} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2.5 md:flex">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--accent))]" />
            <span className="mono-face text-[10px] tracking-[.1em] text-muted-foreground">حالة مباشرة فقط</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 pb-20 pt-9 sm:px-8 sm:pt-12 lg:px-12">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-5 py-7 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <span className="mono-face tracking-[.08em]">إشراف متزن لمجتمعات نشطة</span>
          <span>الإعدادات وإجراءات الإشراف متاحة داخل Discord.</span>
        </div>
      </footer>
    </div>
  );
}

function useBotData() {
  const overviewQuery = useGetBotOverview({
    query: {
      queryKey: getGetBotOverviewQueryKey(),
      refetchOnWindowFocus: true,
    },
  });
  const healthQuery = useHealthCheck({
    query: {
      queryKey: getHealthCheckQueryKey(),
      refetchOnWindowFocus: true,
    },
  });
  return { overviewQuery, healthQuery };
}

function LoadingPanel() {
  return (
    <div className="space-y-7" aria-label="جارٍ تحميل حالة البوت" data-testid="state-loading">
      <div className="skeleton h-5 w-36 rounded-full" />
      <div className="skeleton h-16 max-w-xl rounded-xl" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="skeleton h-28 rounded-2xl" />)}
      </div>
      <div className="skeleton h-64 rounded-2xl" />
    </div>
  );
}

function ErrorState({ onRetry, title = 'تعذّر الاتصال بخدمة الحالة.' }: { onRetry: () => void; title?: string }) {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--card))] px-7 py-10 text-center sm:px-12" data-testid="state-error">
      <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--destructive)/.1)] text-destructive"><ShieldX size={22} /></span>
      <p className="mono-face text-[10px] tracking-[.15em] text-destructive">انقطع الاتصال</p>
      <h2 className="display-face mt-3 text-3xl">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">تعرض لوحة المعلومات بيانات مباشرة فقط. حاول مجددًا بعد قليل، أو تحقّق من حالة البوت في خادم Discord.</p>
      <button onClick={onRetry} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="button-retry-status">
        أعد المحاولة <ArrowRight size={15} />
      </button>
    </section>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return <span className={`relative flex h-2.5 w-2.5 ${connected ? 'text-emerald-700' : 'text-destructive'}`}><span className={`absolute inline-flex h-full w-full rounded-full opacity-35 ${connected ? 'animate-ping bg-emerald-700' : 'bg-destructive'}`} /><span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-700' : 'bg-destructive'}`} /></span>;
}

function StatTile({ label, value, note, icon: Icon, testId }: { label: string; value: string | number; note: string; icon: typeof Users; testId: string }) {
  return (
    <div className="group rounded-2xl border border-border bg-card px-5 py-5 transition-colors hover:border-[hsl(var(--primary)/.32)] sm:px-6">
      <div className="flex items-start justify-between">
        <span className="mono-face text-[10px] uppercase tracking-[.16em] text-muted-foreground">{label}</span>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary"><Icon size={17} strokeWidth={1.7} /></span>
      </div>
      <p className="display-face mt-3 text-[35px] leading-none tracking-[-.04em]" data-testid={testId}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function CommandRow({ command, index }: { command: { name: string; description: string; category: string }; index: number }) {
  return (
    <article className="grid gap-2 border-t border-border py-4 first:border-0 first:pt-0 sm:grid-cols-[minmax(125px,.8fr)_2fr_auto] sm:items-start sm:gap-5" data-testid={`command-row-${index}`}>
      <div className="flex items-center gap-2.5">
        <span className="mono-face text-[11px] font-medium text-primary">/{command.name}</span>
      </div>
        <p className="text-[13px] leading-5 text-muted-foreground">{localizeCommandDescription(command.name, command.description, command.category)}</p>
      <span className="w-fit rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium text-secondary-foreground">{localizeCategory(command.category)}</span>
    </article>
  );
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mb-9 max-w-3xl">
      <p className="mono-face text-[10px] uppercase tracking-[.2em] text-[hsl(var(--primary))]">{eyebrow}</p>
      <h1 className="display-face mt-3 text-[42px] leading-[1.08] tracking-[-.045em] sm:text-[54px]">{title}</h1>
      <p className="mt-4 max-w-2xl text-[14px] leading-6 text-muted-foreground sm:text-[15px]">{description}</p>
    </div>
  );
}

function HomePage() {
  const { overviewQuery, healthQuery } = useBotData();
  const retry = () => { void overviewQuery.refetch(); void healthQuery.refetch(); };

  if (overviewQuery.isLoading || healthQuery.isLoading) return <LoadingPanel />;
  if (overviewQuery.isError || healthQuery.isError || !overviewQuery.data) return <ErrorState onRetry={retry} />;

  const overview = overviewQuery.data;
  const health = healthQuery.data;
  const commands = overview.commands.slice(0, 5);
  const inviteUrl = getBotInviteUrl(overview.applicationId);

  return (
    <div className="page-enter">
      <div className="mb-9 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-2.5" data-testid="status-bot-connection">
          <StatusDot connected={overview.connected} />
          <span className="text-[13px] font-semibold">{overview.connected ? 'البوت متصل' : 'البوت غير متصل'}</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span className="mono-face text-[10px] uppercase tracking-[.1em] text-muted-foreground" data-testid="status-api-health">
            الخدمة: {health ? localizeRuntimeStatus(health.status) : 'غير متاحة'}
          </span>
        </div>
        <button onClick={retry} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground" data-testid="button-refresh-status">
          <RotateCw size={14} /> تحديث الحالة
        </button>
      </div>

      <section className="relative overflow-hidden rounded-[28px] bg-[hsl(var(--primary))] px-6 py-9 text-[hsl(var(--primary-foreground))] sm:px-10 sm:py-12 lg:px-14">
        <div className="pointer-events-none absolute -right-16 -top-24 h-80 w-80 rounded-full border border-[hsl(var(--primary-foreground)/.12)]" />
        <div className="pointer-events-none absolute -right-2 -top-10 h-52 w-52 rounded-full border border-[hsl(var(--primary-foreground)/.12)]" />
        <div className="pointer-events-none absolute bottom-[-130px] right-[18%] h-64 w-64 rounded-full border border-[hsl(var(--primary-foreground)/.1)]" />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-foreground)/.2)] px-3 py-1.5">
            <ShieldCheck size={13} className="text-[hsl(var(--accent))]" />
            <span className="mono-face text-[9px] tracking-[.12em] text-[hsl(var(--primary-foreground)/.78)]">إشراف يراعي ترتيب الرتب</span>
          </div>
          <h1 className="display-face mt-6 text-[43px] leading-[1.2] tracking-[-.045em] sm:text-[62px]">إشراف أكثر اتزانًا<br className="hidden sm:block" /> لمجتمعك.</h1>
          <p className="mt-5 max-w-lg text-[14px] leading-7 text-[hsl(var(--primary-foreground)/.73)] sm:text-[15px]">تابع اتصال بوت الإشراف، وتعرّف إلى إمكاناته، وأبقِ كل إعداد في مكانه الصحيح: داخل Discord.</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/commands" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--accent))] px-5 py-3 text-[13px] font-semibold text-[hsl(var(--foreground))] transition-transform hover:-translate-y-0.5" data-testid="link-explore-commands">
              استعرض الأوامر <ArrowRight size={15} />
            </Link>
            <span className="flex items-center gap-2 text-[11px] text-[hsl(var(--primary-foreground)/.67)]">
              <ShieldCheck size={14} /> الإعداد عبر <span className="mono-face text-[10px] text-[hsl(var(--primary-foreground))]">/setup</span>
            </span>
          </div>
        </div>
        <div className="relative mt-9 flex flex-wrap gap-x-7 gap-y-2 border-t border-[hsl(var(--primary-foreground)/.16)] pt-5 text-[11px] text-[hsl(var(--primary-foreground)/.62)] sm:absolute sm:bottom-8 sm:right-10 sm:mt-0 sm:border-0 sm:pt-0">
          <span className="mono-face">عرض عام لحالة التشغيل</span>
          {overview.botTag && <span className="mono-face" data-testid="text-bot-tag">{overview.botTag}</span>}
        </div>
      </section>

      <section className="mt-7 grid gap-3 sm:grid-cols-3 sm:gap-4" aria-label="ملخص حالة البوت">
        <StatTile label="الخوادم" value={overview.guildCount.toLocaleString('ar')} note="المجتمعات التي انضم إليها البوت" icon={Users} testId="value-guild-count" />
        <StatTile label="الأوامر" value={overview.commandCount.toLocaleString('ar')} note="متاحة داخل Discord" icon={Command} testId="value-command-count" />
        <StatTile label="التطبيق" value={overview.applicationId ? 'مسجّل' : '—'} note={overview.applicationId ? `المعرّف ${overview.applicationId}` : 'الهوية غير متاحة'} icon={Shield} testId="value-application-id" />
      </section>

      <section className="mt-14 grid gap-10 lg:grid-cols-[.78fr_1.22fr] lg:gap-16">
        <div className="rise-in">
          <p className="mono-face text-[10px] tracking-[.15em] text-muted-foreground">الإعداد في مكانه الصحيح</p>
          <h2 className="display-face mt-3 text-[31px] leading-tight tracking-[-.035em]">قواعد خادمك، بقرارك.</h2>
          <p className="mt-4 text-[13px] leading-7 text-muted-foreground">يراعي بوت الإشراف ترتيب الرتب في Discord. يضبط مسؤولو الخادم الصلاحيات والسلوك باستخدام أوامر البوت، وليس من لوحة الحالة هذه.</p>
          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <p className="mono-face text-[10px] tracking-[.12em] text-muted-foreground">ابدأ من خادمك</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary"><Hash size={16} /></span>
              <div>
                <p className="text-[13px] font-semibold">استخدم <code className="mono-face text-[12px] text-primary">/setup</code></p>
                <p className="mt-1 text-[11px] text-muted-foreground">حدّد من يحق له استخدام إجراءات الإشراف.</p>
              </div>
            </div>
          </div>
          {inviteUrl && (
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-[13px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
              data-testid="link-invite-bot"
            >
              إضافة البوت إلى خادمك <ArrowRight size={15} />
            </a>
          )}
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            قبل الدعوة، فعّل <span dir="ltr" className="mono-face">Server Members Intent</span> في صفحة Bot داخل Discord Developer Portal، ثم ارفع رتبة البوت فوق الرتب التي سيديرها.
          </p>
          <div className="mt-4 flex items-start gap-2.5 text-[11px] leading-5 text-muted-foreground">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-primary" />
            <p>لا يستطيع المشرف اتخاذ إجراء ضد عضو إلا إذا كانت رتبته أعلى من رتبة العضو.</p>
          </div>
        </div>
        <div className="rise-in stagger-1 rounded-[24px] border border-border bg-card p-5 sm:p-7">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="mono-face text-[10px] tracking-[.14em] text-muted-foreground">لمحة سريعة</p>
              <h2 className="display-face mt-2 text-[27px] tracking-[-.035em]">دليل الأوامر</h2>
            </div>
            <Link href="/commands" className="inline-flex items-center gap-1.5 pb-1 text-[12px] font-semibold text-primary hover:underline" data-testid="link-full-catalog">
              الدليل كاملًا <ArrowRight size={14} />
            </Link>
          </div>
          {commands.length ? (
            <div data-testid="list-command-preview">
              {commands.map((command, index) => <CommandRow key={`${command.category}-${command.name}`} command={command} index={index} />)}
            </div>
          ) : (
            <EmptyCommands />
          )}
        </div>
      </section>

      <div className="mt-12 flex items-center justify-between border-t border-border pt-5">
        <p className="text-[11px] text-muted-foreground">بيانات مباشرة من تشغيل البوت.</p>
        <span className="inline-flex items-center gap-1.5 mono-face text-[9px] tracking-[.1em] text-muted-foreground"><Check size={12} className="text-primary" /> لا توجد أدوات تحكم في المتصفح</span>
      </div>
    </div>
  );
}

function EmptyCommands() {
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center" data-testid="state-empty-commands">
      <Command size={20} className="mx-auto text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">لا توجد أوامر للعرض حاليًا</p>
      <p className="mt-1 text-xs text-muted-foreground">دليل الأوامر المباشر فارغ في الوقت الحالي.</p>
    </div>
  );
}

function CommandsPage() {
  const { overviewQuery, healthQuery } = useBotData();
  const [search, setSearch] = useState('');
  const retry = () => { void overviewQuery.refetch(); void healthQuery.refetch(); };
  const commands = overviewQuery.data?.commands ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) => `${command.name} ${command.description} ${command.category}`.toLowerCase().includes(term));
  }, [commands, search]);
  const groups = useMemo(() => {
    const byCategory = new Map<string, typeof filtered>();
    filtered.forEach((command) => {
      const category = command.category.trim() || 'Other';
      byCategory.set(category, [...(byCategory.get(category) ?? []), command]);
    });
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (overviewQuery.isLoading || healthQuery.isLoading) return <LoadingPanel />;
  if (overviewQuery.isError || healthQuery.isError || !overviewQuery.data) return <ErrorState onRetry={retry} />;

  return (
    <div className="page-enter">
      <div className="mb-8 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Link href="/" className="hover:text-foreground" data-testid="link-breadcrumb-home">نظرة عامة</Link>
        <ChevronRight size={13} />
        <span className="text-foreground">الأوامر</span>
      </div>
      <PageIntro eyebrow="مرجع الأوامر" title="كل ما يتيحه البوت، بوضوح." description="تصفّح الأوامر المتاحة حاليًا من البوت. يدير فريق الخادم الصلاحيات والإعدادات من داخل Discord." />

      <div className="mb-7 grid gap-3 rounded-[22px] border border-border bg-[hsl(var(--secondary)/.55)] p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-primary"><ShieldCheck size={17} /></span>
          <div>
            <p className="text-[13px] font-semibold">تُضبط الصلاحيات من داخل Discord</p>
            <p className="mt-1 text-[12px] leading-6 text-muted-foreground">استخدم <code className="mono-face text-[11px] text-primary">/setup</code> في خادمك لتحديد من يمكنه استخدام أوامر الإشراف. لا يغيّر هذا الدليل الصلاحيات.</p>
          </div>
        </div>
        <span className={`flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[11px] font-medium ${overviewQuery.data.connected ? 'text-foreground' : 'text-destructive'}`} data-testid="status-catalog-connection">
          <StatusDot connected={overviewQuery.data.connected} />
          {overviewQuery.data.connected ? 'البوت متصل' : 'البوت غير متصل'}
        </span>
      </div>

      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mono-face text-[10px] tracking-[.14em] text-muted-foreground">الدليل</p>
          <h2 className="display-face mt-1 text-[28px] tracking-[-.035em]">الأوامر المتاحة</h2>
        </div>
        <label className="relative block w-full sm:max-w-[340px]">
          <Search size={16} className="command-search-icon absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن أمر أو فئة" className="command-search-input h-11 w-full rounded-full border border-border bg-card pl-10 pr-11 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-primary" aria-label="ابحث عن الأوامر" data-testid="input-search-commands" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="مسح البحث" className="command-search-clear absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="button-clear-search"><X size={14} /></button>}
        </label>
      </div>

      {groups.length ? (
        <div className="space-y-5" data-testid="list-command-catalog">
          {groups.map(([category, items]) => (
            <section key={category} className="overflow-hidden rounded-[22px] border border-border bg-card" data-testid={`category-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
              <div className="flex items-center justify-between border-b border-border bg-[hsl(var(--secondary)/.38)] px-5 py-4 sm:px-6">
                <h3 className="text-[13px] font-semibold">{localizeCategory(category)}</h3>
                <span className="mono-face text-[10px] text-muted-foreground">{items.length.toLocaleString('ar')} {items.length === 1 ? 'أمر' : 'أوامر'}</span>
              </div>
              <div className="divide-y divide-border px-5 sm:px-6">
                {items.map((command, index) => (
                  <article key={`${category}-${command.name}`} className="grid gap-2 py-4 sm:grid-cols-[minmax(135px,.7fr)_2fr] sm:gap-6 sm:py-5" data-testid={`command-item-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}`}>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 text-[10px] text-[hsl(var(--accent))]">/</span>
                      <code className="mono-face text-[12px] font-medium text-primary">{command.name}</code>
                    </div>
                    <p className="text-[13px] leading-6 text-muted-foreground">{localizeCommandDescription(command.name, command.description, command.category)}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-[22px] border border-dashed border-border bg-card px-6 py-14 text-center" data-testid="state-empty-search">
          <Search size={22} className="mx-auto text-muted-foreground" />
          <h3 className="display-face mt-4 text-2xl">{commands.length ? 'لا توجد أوامر مطابقة' : 'لم تُنشر أوامر بعد'}</h3>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground">{commands.length ? 'جرّب البحث باسم أمر أو وصفه أو فئته.' : 'ستظهر الأوامر هنا عندما يوفّرها البوت.'}</p>
          {search && <button onClick={() => setSearch('')} className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium hover:bg-secondary" data-testid="button-reset-search">مسح البحث <ArrowLeft size={13} /></button>}
        </div>
      )}

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-[11px] text-muted-foreground">
        <span data-testid="text-command-total">عرض {filtered.length.toLocaleString('ar')} من {overviewQuery.data.commandCount.toLocaleString('ar')} أمرًا</span>
        <span className="flex items-center gap-2"><StatusDot connected={!!healthQuery.data && ['ok', 'healthy', 'online', 'up'].includes(healthQuery.data.status.toLowerCase())} /> حالة التشغيل: {healthQuery.data ? localizeRuntimeStatus(healthQuery.data.status) : 'غير متاحة'}</span>
      </div>
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <AppShell>
      <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/commands" component={CommandsPage} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </AppShell>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    document.title = 'بوت الإشراف | مركز تحكم Discord';
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
