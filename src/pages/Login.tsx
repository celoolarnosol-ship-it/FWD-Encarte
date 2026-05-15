import React from 'react';
import { GoogleLoginButton } from '../components/auth/GoogleLoginButton';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-chat)] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-[var(--color-primary-light)] rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">🎨</span>
        </div>
        <h1 className="text-[var(--color-text-primary)] text-2xl font-bold mb-2">Dr. Encarte</h1>
        <p className="text-[var(--color-text-secondary)] text-sm mb-8 font-medium">
          Gere encartes promocionais com inteligência artificial
        </p>
        <GoogleLoginButton />
      </div>
    </div>
  );
}
