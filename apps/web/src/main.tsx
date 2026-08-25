import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/app';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент #root');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Сервис-воркер нужен, чтобы приложение можно было установить на телефон
// и чтобы оболочка открывалась без сети. В разработке он только мешает.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Регистрация может не пройти в приватном режиме — это не ошибка приложения.
    });
  });
}
