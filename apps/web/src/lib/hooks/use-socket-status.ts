import * as React from 'react';
import { getSocket } from '@/lib/socket';

/**
 * Состояние реалтайм-соединения.
 *
 * Важно показывать явно: если сокет отвалился (перезапуск сервера, спящий
 * ноутбук), доска продолжает выглядеть живой, но чужие изменения до неё
 * не доходят. Молчаливо устаревший интерфейс хуже честного «связи нет».
 */
export function useSocketConnected(): boolean {
  const [connected, setConnected] = React.useState(() => getSocket().connected);

  React.useEffect(() => {
    const socket = getSocket();
    const onConnect = (): void => setConnected(true);
    const onDisconnect = (): void => setConnected(false);

    setConnected(socket.connected);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return connected;
}
