'use client';
import { Alert, Button } from '@/components/nc/basics';

export default function PortalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="max-w-2xl">
      <Alert tone="error" title="This page couldn’t load" action={<Button icon="retry" onClick={reset}>Try again</Button>}>
        {error.message}
      </Alert>
    </div>
  );
}
