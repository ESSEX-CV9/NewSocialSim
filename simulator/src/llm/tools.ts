import type { ToolDefinition } from './types.js';
import type { ApiClient } from '../api-client.js';

export interface ToolExecutor {
  definitions: ToolDefinition[];
  execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<string>;
}

export interface ToolContext {
  token: string;
  adminToken: string;
  userId: string;
  handle: string;
}

export function createToolExecutor(api: ApiClient): ToolExecutor {
  const defs: ToolDefinition[] = [
    {
      name: 'browse_timeline',
      description: 'Browse the global timeline to see recent posts from all users.',
      input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Number of posts to fetch (default 10)' } } },
    },
    {
      name: 'get_trending_topics',
      description: 'Get the list of currently active topics in the world.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'read_npc_profile',
      description: 'Read the personality profile of an NPC by user ID.',
      input_schema: { type: 'object', properties: { userId: { type: 'number', description: 'The user ID to look up' } }, required: ['userId'] },
    },
    {
      name: 'read_lore',
      description: 'Read a lore/worldbuilding document by filename.',
      input_schema: { type: 'object', properties: { filename: { type: 'string', description: 'The .md filename to read' } }, required: ['filename'] },
    },
    {
      name: 'list_lore',
      description: 'List all lore documents with their summaries.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'search_posts',
      description: 'Search posts by keyword.',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    },
    {
      name: 'get_user_posts',
      description: 'Get recent posts by a specific user.',
      input_schema: { type: 'object', properties: { userId: { type: 'string' }, limit: { type: 'number' } }, required: ['userId'] },
    },
    {
      name: 'create_post',
      description: 'Create a new post. This is how you publish content to the social network.',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The post text (max 280 chars)' },
          replyToId: { type: 'string', description: 'If replying, the ID of the post to reply to' },
        },
        required: ['content'],
      },
    },
    {
      name: 'like_post',
      description: 'Like a post.',
      input_schema: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
    },
    {
      name: 'repost',
      description: 'Repost/retweet a post.',
      input_schema: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
    },
    {
      name: 'follow_user',
      description: 'Follow a user.',
      input_schema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
    },
    {
      name: 'search_media',
      description: 'Search for images by keyword. Returns candidate URLs that can be attached to posts.',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, source: { type: 'string', description: 'Image source (optional)' } }, required: ['query'] },
    },
  ];

  async function execute(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    try {
      switch (name) {
        case 'browse_timeline': {
          const data = await api.getTimeline(ctx.token, (input.limit as number) ?? 10);
          const posts = data.items.map((item: any) => {
            const p = item.post ?? item;
            return { id: p.id, author: p.author?.handle, content: p.content?.slice(0, 200), likes: p.likeCount, reposts: p.repostCount };
          });
          return JSON.stringify(posts);
        }
        case 'get_trending_topics': {
          const data = await api.getActiveTopics(ctx.adminToken);
          return JSON.stringify(data.topics.map((t: any) => ({ id: t.id, title: t.title, heat: t.heat, stage: t.stage, tags: t.tags })));
        }
        case 'read_npc_profile': {
          const data = await api.get(`/api/admin/npc-profiles/${input.userId}`, ctx.adminToken);
          return JSON.stringify(data);
        }
        case 'read_lore': {
          const data = await api.get(`/api/admin/lore/${encodeURIComponent(input.filename as string)}`, ctx.adminToken);
          return (data as any).content;
        }
        case 'list_lore': {
          const data = await api.get('/api/admin/lore', ctx.adminToken);
          return JSON.stringify((data as any).files);
        }
        case 'search_posts': {
          const data = await api.searchPosts(input.query as string, ctx.token, (input.limit as number) ?? 10);
          const posts = data.items.map((p: any) => ({ id: p.id, author: p.author?.handle, content: p.content?.slice(0, 200) }));
          return JSON.stringify(posts);
        }
        case 'get_user_posts': {
          const data = await api.getUserPosts(input.userId as string, ctx.token, (input.limit as number) ?? 10);
          const posts = data.items.map((p: any) => ({ id: p.id, content: p.content?.slice(0, 200), likes: p.likeCount }));
          return JSON.stringify(posts);
        }
        case 'create_post': {
          const result = await api.createPost(ctx.token, input.content as string, input.replyToId as string | undefined);
          return JSON.stringify({ success: true, postId: result.id });
        }
        case 'like_post': {
          await api.likePost(ctx.token, input.postId as string);
          return JSON.stringify({ success: true });
        }
        case 'repost': {
          await api.repost(ctx.token, input.postId as string);
          return JSON.stringify({ success: true });
        }
        case 'follow_user': {
          await api.follow(ctx.token, input.userId as string);
          return JSON.stringify({ success: true });
        }
        case 'search_media': {
          const params = new URLSearchParams({ q: input.query as string });
          if (input.source) params.set('source', input.source as string);
          const data = await api.get(`/api/media-search?${params}`, ctx.token);
          return JSON.stringify(data);
        }
        default:
          return JSON.stringify({ error: `Unknown tool: ${name}` });
      }
    } catch (err: any) {
      return JSON.stringify({ error: err.message ?? String(err) });
    }
  }

  return { definitions: defs, execute };
}
