import type { Metadata } from 'next';
import Image from 'next/image';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:flex-row">
      <section
        aria-label="Nigerian Army College of Logistics and Management"
        className="relative flex shrink-0 flex-col items-center justify-center gap-4 border-b-[3px] border-army-red bg-command px-6 py-8 text-center text-on-command lg:w-[46%] lg:border-b-0 lg:border-r-4 lg:px-12 lg:py-16"
      >
        <Image
          src="/brand/nacolm-crest.png"
          alt="Crest of the Nigerian Army College of Logistics and Management"
          width={493}
          height={512}
          priority
          className="h-24 w-auto drop-shadow-[0_6px_16px_rgba(0,0,0,0.35)] lg:h-60"
        />
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm text-on-command-muted lg:text-base">Nigerian Army College of Logistics and Management</p>
          <h1 className="m-0 text-[28px] font-[750] leading-8 tracking-[-0.01em] lg:text-[44px] lg:leading-[48px]" style={{ fontStretch: '88%' }}>
            NACOLM CBT
          </h1>
          <p className="m-0 text-sm text-on-command-muted lg:text-[15px]">Set, review and freeze exam papers you can defend.</p>
        </div>
        <div className="mt-2 hidden items-center gap-3 lg:absolute lg:bottom-8 lg:flex">
          <Image src="/brand/nigerian-army.png" alt="Nigerian Army emblem" width={400} height={303} className="h-10 w-auto" />
          <span className="text-left text-xs leading-4 text-on-command-muted">Nigerian Army</span>
        </div>
      </section>

      <main className="flex flex-1 items-start justify-center px-4 py-8 lg:items-center lg:px-12">
        <div className="w-full max-w-[400px]">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
