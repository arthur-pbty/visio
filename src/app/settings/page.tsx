'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';

export default function SettingsPage() {
  const router = useRouter();
  const [userName, setUserName] = useLocalStorage<string>('visio_username', '');
  const [inputName, setInputName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setInputName(userName);
  }, [userName]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setUserName(inputName.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <main className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Visio</h1>
            </Link>
            <button
              onClick={() => router.back()}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="card">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Paramètres</h2>
          
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                Votre nom d'affichage
              </label>
              <input
                type="text"
                id="username"
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                placeholder="Entrez votre nom"
                className="input-field"
              />
              <p className="mt-2 text-sm text-gray-500">
                Ce nom sera affiché aux autres participants lors de vos visioconférences.
                Il est sauvegardé dans votre navigateur.
              </p>
            </div>

            <div className="flex items-center space-x-4">
              <button type="submit" className="btn-primary">
                Enregistrer
              </button>
              {saved && (
                <span className="text-green-600 flex items-center">
                  <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Enregistré !
                </span>
              )}
            </div>
          </form>

          <hr className="my-8 border-gray-200" />

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">À propos</h3>
            <p className="text-gray-600 text-sm">
              Visio est un service de visioconférence gratuit et sans inscription. 
              Vos données ne sont pas collectées et les salles se ferment automatiquement 
              après 5 minutes d'inactivité.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-blue-500 hover:text-blue-600 font-medium">
            ← Retour à l'accueil
          </Link>
        </div>
      </div>
    </main>
  );
}
