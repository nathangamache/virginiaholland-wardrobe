import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { NavBar } from '@/components/NavBar';
import { Header } from '@/components/Header';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen flex flex-col">
      <Header email={session.email} />
      <main className="flex-1 pb-24">{children}</main>
      <NavBar />
    </div>
  );
}
