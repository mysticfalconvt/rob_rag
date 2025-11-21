import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { config } from '@/lib/config';

export async function GET() {
    try {
        // Try to get settings from database
        let settings = await prisma.settings.findUnique({
            where: { id: 'singleton' }
        });

        // If no settings exist, return defaults from env
        if (!settings) {
            return NextResponse.json({
                embeddingModel: config.EMBEDDING_MODEL_NAME,
                chatModel: config.CHAT_MODEL_NAME,
                embeddingModelDimension: 1024,
                isDefault: true
            });
        }

        return NextResponse.json({
            embeddingModel: settings.embeddingModel,
            chatModel: settings.chatModel,
            embeddingModelDimension: settings.embeddingModelDimension,
            isDefault: false
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { embeddingModel, chatModel, embeddingModelDimension } = await req.json();

        const settings = await prisma.settings.upsert({
            where: { id: 'singleton' },
            update: {
                embeddingModel,
                chatModel,
                embeddingModelDimension: embeddingModelDimension || 1024
            },
            create: {
                id: 'singleton',
                embeddingModel,
                chatModel,
                embeddingModelDimension: embeddingModelDimension || 1024
            }
        });

        return NextResponse.json(settings);
    } catch (error) {
        console.error('Error updating settings:', error);
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}
