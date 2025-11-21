import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/retrieval';
import { chatModel } from '@/lib/ai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';

export async function POST(req: NextRequest) {
    try {
        const { messages } = await req.json();
        const lastMessage = messages[messages.length - 1];
        const query = lastMessage.content;

        // 1. Retrieve context
        const searchResults = await search(query);
        const context = searchResults.map(r => `Content: ${r.content}\nSource: ${r.metadata.fileName}`).join('\n\n');

        // 2. Build system prompt
        const systemPrompt = `You are a helpful assistant. Use the following context to answer the user's question.
If the answer is not in the context, say so, but you can still try to answer from general knowledge if appropriate, while noting it's not in the docs.
Always cite your sources if you use the context.

Context:
${context}`;

        // 3. Prepare messages for LangChain
        const langchainMessages = [
            new SystemMessage(systemPrompt),
            ...messages.slice(0, -1).map((m: any) =>
                m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
            ),
            new HumanMessage(query)
        ];

        // 4. Stream response
        const parser = new StringOutputParser();
        const stream = await chatModel.pipe(parser).stream(langchainMessages);

        // Convert string stream to byte stream for NextResponse
        const iterator = stream[Symbol.asyncIterator]();
        const byteStream = new ReadableStream({
            async pull(controller) {
                const { value, done } = await iterator.next();
                if (done) {
                    controller.close();
                } else {
                    controller.enqueue(new TextEncoder().encode(value));
                }
            },
        });

        return new NextResponse(byteStream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
            },
        });

    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
