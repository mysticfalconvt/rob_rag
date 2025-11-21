import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
    try {
        const conversations = await prisma.conversation.findMany({
            orderBy: { updatedAt: 'desc' },
            take: 20,
            include: {
                _count: {
                    select: { messages: true },
                },
            },
        });

        return NextResponse.json(conversations);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { title } = await req.json();

        const conversation = await prisma.conversation.create({
            data: {
                title: title || 'New Conversation',
            },
        });

        return NextResponse.json(conversation);
    } catch (error) {
        console.error('Error creating conversation:', error);
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
    }
}
