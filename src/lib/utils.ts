import { v4 as uuidv4 } from 'uuid';

export function generateRoomId(): string {
  return uuidv4().slice(0, 8);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
