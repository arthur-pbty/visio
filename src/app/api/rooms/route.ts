import { NextResponse } from 'next/server';
import { createRoom, getRoom } from '@/lib/database';
import { generateRoomId } from '@/lib/utils';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name } = body;
    
    const roomId = generateRoomId();
    const room = createRoom(roomId, name || 'Visioconférence');
    
    return NextResponse.json({
      id: room.id,
      name: room.name,
      created_at: room.created_at,
    });
  } catch (error) {
    console.error('Erreur lors de la création de la salle:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la création de la salle' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  
  if (!id) {
    return NextResponse.json(
      { error: 'ID de salle requis' },
      { status: 400 }
    );
  }
  
  const room = getRoom(id);
  
  if (!room) {
    return NextResponse.json(
      { error: 'Salle non trouvée' },
      { status: 404 }
    );
  }
  
  return NextResponse.json(room);
}
