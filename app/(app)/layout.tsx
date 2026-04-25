import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { NavBar } from '@/components/NavBar';
import { Header } from '@/components/Header';
import { DialogProvider } from '@/components/DialogProvider';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <DialogProvider>
      <div className="min-h-screen flex flex-col">
        <Header email={session.email} />
        <main
          className="flex-1"
          // Pad past the fixed bottom nav: its content is ~64px, plus 14-24px
          // of bottom breathing room, plus iPhone safe-area inset. 96+ ensures
          // no overlap on any device.
          style={{
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
          }}
        >
          {children}
        </main>
        <NavBar />
      </div>
    </DialogProvider>
  );
}
