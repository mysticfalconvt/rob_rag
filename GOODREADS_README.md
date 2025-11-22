# Goodreads Integration Guide

This guide explains how to set up and use the Goodreads library integration in your RAG application.

## Overview

The Goodreads integration allows you to:
- Import your reading history from Goodreads CSV exports
- Sync your library automatically via RSS feeds
- Query your reading history using natural language in your RAG system
- Support multiple users with separate reading histories

## Getting Started

### Step 1: Access the Status Page

Navigate to `/status` in your application to access the Goodreads integration interface.

### Step 2: Add a User

1. Click **"+ Add User"** in the Goodreads Library Integration section
2. Enter the user's name (required)
3. Optionally enter an email address
4. Click **"Add User"**

### Step 3: Upload Your Goodreads Library (CSV Method)

#### Exporting from Goodreads:
1. Go to [Goodreads](https://www.goodreads.com/)
2. Click on **"My Books"**
3. Scroll to the bottom and click **"Import and export"**
4. Click **"Export Library"**
5. Download the CSV file

#### Uploading to the App:
1. In the status page, find your user card
2. Click **"Choose File"** under "Upload CSV"
3. Select your downloaded Goodreads CSV file
4. Click **"Upload CSV"**
5. Wait for the upload to complete (you'll see a success message with stats)

### Step 4: Set Up RSS Feed (Optional but Recommended)

RSS feeds allow automatic syncing of new books as you add them to Goodreads.

#### Getting Your RSS Feed URL:
1. Go to [Goodreads](https://www.goodreads.com/)
2. Click on **"My Books"**
3. Scroll to the bottom and look for **"RSS"** link
4. Copy the RSS feed URL (it should look like: `https://www.goodreads.com/review/list_rss/YOUR_USER_ID?key=YOUR_KEY&shelf=%23ALL%23`)

#### Adding RSS Feed to the App:
1. In the status page, find your user card
2. Paste your RSS feed URL in the **"RSS Feed URL"** field
3. Click **"Save RSS Feed"**
4. Click **"Sync Now"** to test the feed

## Using the Integration

### Manual Sync

Click **"Sync Now"** on any user's card to manually sync their RSS feed. This will:
- Fetch the latest data from Goodreads
- Update existing books
- Add newly read books
- Re-generate RAG embeddings

### Automated Sync

See [GOODREADS_SCHEDULING.md](./GOODREADS_SCHEDULING.md) for instructions on setting up automated daily/weekly syncs.

### Querying Your Reading History

Once your books are imported, you can ask questions like:

- "What 5-star books did I read in 2024?"
- "What books by Brandon Sanderson have I read?"
- "Show me sci-fi books I rated highly"
- "What was the last book I read?"
- "What books has Alice reviewed?"
- "Which users have read The Hunger Games?"

The RAG system will retrieve relevant books and provide context-aware answers.

## Data Format

Each book is stored with the following information:

**From CSV:**
- Title, Author, Additional Authors
- ISBN, ISBN13
- Your rating (0-5 stars)
- Average rating
- Date read, Date added
- Shelves (read, currently-reading, to-read, custom shelves)
- Your review text
- Spoiler flag, Private notes
- Pages, Year published
- Read count

**From RSS:**
- Title, Author
- ISBN
- Your rating
- Average rating
- Date read, Date added
- Shelves
- Review text

## RAG Chunk Format

Each book generates a text chunk like:

> "John Smith read 'Project Hail Mary' by Andy Weir in March 2024, rated it 5 stars, shelved as: read, sci-fi. Review: Amazing space survival story with great humor and science. (476 pages, published 2021)"

This format allows the RAG system to understand:
- **Who** read the book
- **What** book it was (title, author)
- **When** it was read
- **How** they rated it
- **Why** they liked/disliked it (from review)
- **Context** (genre shelves, page count, publication year)

## Troubleshooting

### CSV Upload Fails
- Ensure you're uploading a valid Goodreads CSV export
- Check that the file is not corrupted
- Verify the user exists

### RSS Sync Fails
- Verify your RSS feed URL is correct
- Check that your Goodreads profile is not private
- Ensure the RSS feed key hasn't expired (regenerate from Goodreads if needed)

### Books Not Appearing in Queries
- Wait a few moments after upload/sync for embedding generation
- Check that the book was successfully imported (refresh the status page)
- Try more specific queries

### Multiple Users
- Each user's library is kept separate
- You can query across all users or filter by specific user names
- User names are included in RAG chunks for disambiguation

## API Endpoints

If you want to integrate programmatically:

- `GET /api/goodreads/users` - List all users
- `POST /api/goodreads/users` - Create a new user
- `POST /api/goodreads/upload-csv` - Upload CSV for a user
- `POST /api/goodreads/rss` - Configure RSS feed for a user
- `GET /api/goodreads/rss?userId=...` - Get RSS source for a user
- `POST /api/goodreads/sync` - Sync one user's RSS feed
- `POST /api/goodreads/sync-all` - Sync all RSS feeds (for cron jobs)

## Privacy & Data Storage

- All data is stored locally in your database
- Book data includes only what Goodreads provides in exports/RSS
- No data is sent to external services except when fetching RSS feeds
- Delete a user's data by removing them from the database

## Future Enhancements

Potential improvements:
- Book cover images in UI
- Reading stats and analytics
- Book recommendations based on ratings
- Integration with other reading platforms
- Bulk user management
- Enhanced search filters (by year, rating, shelf, etc.)

## Support

For issues or feature requests, see the main project repository.

---

Happy reading! 📚
