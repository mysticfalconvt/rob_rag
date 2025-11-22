import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/retrieval';
import { chatModel } from '@/lib/ai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import prisma from '@/lib/prisma';
import { readFileContent } from '@/lib/files';

export async function POST(req: NextRequest) {
    try {
        const { messages, conversationId, sourceFilter } = await req.json();
        const lastMessage = messages[messages.length - 1];
        const query = lastMessage.content;

        // Create or get conversation
        let convId = conversationId;
        if (!convId) {
            // Create new conversation with title from first message
            const title = query.substring(0, 50) + (query.length > 50 ? '...' : '');
            const conversation = await prisma.conversation.create({
                data: { title },
            });
            convId = conversation.id;
        }

        // Save user message
        await prisma.message.create({
            data: {
                conversationId: convId,
                role: 'user',
                content: query,
            },
        });

        // 1. Retrieve context (skip if sourceFilter is 'none')
        let searchResults: any[] = [];
        let context = '';

        if (sourceFilter !== 'none') {
            console.log('Searching for:', query, 'with filter:', sourceFilter || 'all');
            searchResults = await search(query, 5, sourceFilter);
            console.log('Found', searchResults.length, 'results');
            // console.log('Search result scores:', searchResults.map(r => ({ file: r.metadata.fileName, score: r.score })));

            // Context Optimization: Group by file and check if we should load full content
            const groupedResults: Record<string, typeof searchResults> = {};
            searchResults.forEach(r => {
                const path = r.metadata.filePath;
                if (path) {
                    if (!groupedResults[path]) groupedResults[path] = [];
                    groupedResults[path].push(r);
                }
            });

            const contextParts: string[] = [];
            const processedFiles = new Set<string>();

            for (const result of searchResults) {
                const filePath = result.metadata.filePath;
                if (!filePath || processedFiles.has(filePath)) continue;

                const fileResults = groupedResults[filePath];
                const totalChunks = result.metadata.totalChunks || 100; // Default to high if missing

                // Heuristic: Load full file if:
                // 1. File is small (<= 5 chunks)
                // 2. We have a significant portion of the file (> 30% of chunks)
                const isSmallFile = totalChunks <= 5;
                const hasSignificantPortion = (fileResults.length / totalChunks) > 0.3;

                if (isSmallFile || hasSignificantPortion) {
                    try {
                        console.log(`Loading full content for ${result.metadata.fileName} (Chunks: ${totalChunks}, Found: ${fileResults.length})`);
                        const { content: fullContent } = await readFileContent(filePath);
                        contextParts.push(`Document: ${result.metadata.fileName}\n(Full Content)\n${fullContent}`);
                        processedFiles.add(filePath);
                    } catch (e) {
                        console.error(`Failed to read full file ${filePath}, falling back to chunks`, e);
                        // Fallback to adding just this chunk (and others will be added as we iterate)
                        contextParts.push(`Document: ${result.metadata.fileName}\nContent: ${result.content}`);
                    }
                } else {
                    // Add just this chunk
                    contextParts.push(`Document: ${result.metadata.fileName}\nContent: ${result.content}`);
                }
            }

            context = contextParts.join('\n\n');
        } else {
            console.log('No sources mode - chatting without document context');
        }

        // 2. Build system prompt
        const systemPrompt = sourceFilter === 'none'
            ? `You are a helpful assistant. Answer the user's questions to the best of your ability.`
            : `You are a helpful assistant. Use the following context to answer the user's question.
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
        console.log('Calling LM Studio...');
        const parser = new StringOutputParser();
        const stream = await chatModel.pipe(parser).stream(langchainMessages);

        // Collect response for saving
        let fullResponse = '';

        // Convert string stream to byte stream for NextResponse
        const iterator = stream[Symbol.asyncIterator]();
        const byteStream = new ReadableStream({
            async pull(controller) {
                try {
                    const { value, done } = await iterator.next();
                    if (done) {
                        // Generate title if this is the first message
                        if (messages.length === 1) {
                            try {
                                const titlePrompt = `Generate a short, concise title (maximum 10 words) for this conversation based on the following exchange:
User: ${query}
Assistant: ${fullResponse}

Title:`;
                                const titleResponse = await chatModel.invoke([
                                    new HumanMessage(titlePrompt)
                                ]);
                                const newTitle = typeof titleResponse.content === 'string'
                                    ? titleResponse.content.replace(/^["']|["']$/g, '').trim()
                                    : '';

                                if (newTitle) {
                                    await prisma.conversation.update({
                                        where: { id: convId },
                                        data: { title: newTitle }
                                    });
                                }
                            } catch (error) {
                                console.error('Failed to generate title:', error);
                            }
                        }

                        // Save assistant message to database
                        const sourcesData = {
                            type: 'sources',
                            sources: searchResults.map(r => ({
                                fileName: r.metadata.fileName,
                                filePath: r.metadata.filePath,
                                chunk: r.content,
                                score: r.score,
                            })),
                        };

                        await prisma.message.create({
                            data: {
                                conversationId: convId,
                                role: 'assistant',
                                content: fullResponse,
                                sources: JSON.stringify(sourcesData.sources),
                            },
                        });

                        // Update conversation timestamp
                        await prisma.conversation.update({
                            where: { id: convId },
                            data: { updatedAt: new Date() },
                        });

                        // Send sources and conversation ID
                        const finalData = {
                            ...sourcesData,
                            conversationId: convId,
                        };
                        controller.enqueue(
                            new TextEncoder().encode('\n__SOURCES__:' + JSON.stringify(finalData))
                        );
                        controller.close();
                    } else {
                        fullResponse += value;
                        controller.enqueue(new TextEncoder().encode(value));
                    }
                } catch (error) {
                    console.error('Stream error:', error);
                    controller.error(error);
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
        console.error('Error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        });
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
