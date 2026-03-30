import { NextResponse } from 'next/server';
import { getRoom, updateRoomActivity, closeRoom } from '@/lib/database';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  const room = getRoom(id);
  
  if (!room) {
    return NextResponse.json(
      { error: 'Salle non trouvée' },
      { status: 404 }
    );
  }
  
  if (!room.is_active) {
    return NextResponse.json(
      { error: 'Cette salle a été fermée' },
      { status: 410 }
    );
  }
  
  return NextResponse.json(room);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  const room = getRoom(id);
  
  if (!room) {
    return NextResponse.json(
      { error: 'Salle non trouvée' },
      { status: 404 }
    );
  }
  
  updateRoomActivity(id);
  
  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  const room = getRoom(id);
  
  if (!room) {
    return NextResponse.json(
      { error: 'Salle non trouvée' },
      { status: 404 }
    );
  }
  
  closeRoom(id);
  
  return NextResponse.json({ success: true });
}
