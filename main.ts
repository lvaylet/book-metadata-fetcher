import { Plugin, TFile, requestUrl, Notice } from 'obsidian';

// Interface to structure the retrieved metadata
interface BookMetadata {
    title: string;
    author: string;
    publisher: string;
    pageCount: number;
    publishedDate: string;
    coverUrl: string;
}

export default class BookMetadataFetcherPlugin extends Plugin {
    
    // On plugin load
    async onload() {
        // Register the command
        this.addCommand({
            id: 'fetch-book-metadata',
            name: 'Fetch Book Metadata (from EAN/ISBN)',
            callback: () => this.fetchMetadata(),
        });
    }

    // Main function called by the command
    async fetchMetadata() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('Please open a book note to use this command.');
            return;
        }

        // 1. Read the EAN from the Frontmatter
        const fileCache = this.app.metadataCache.getFileCache(activeFile as TFile);
        const frontmatter = fileCache?.frontmatter;
        
        const ean = frontmatter?.ean; // Assuming the property is named 'ean'
        
        if (!ean) {
            new Notice('The "ean" property is missing in the Frontmatter.');
            return;
        }

        new Notice(`Searching for book with EAN: ${ean}...`);

        try {
            // 2. Call the Google Books API
            const bookData = await this.fetchBookMetadata(ean);

            // 3. Update the note
            await this.updateNoteWithMetadata(activeFile as TFile, bookData);
            
            new Notice('Book metadata successfully updated!');

        } catch (error) {
            console.error(error);
            // Check if the error is a standard Error object to display its message
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
            new Notice(`Error: ${errorMessage}`);
        }
    }

    /**
     * Calls the Google Books API using the EAN (ISBN)
     * @param ean The EAN (which works as ISBN) to search for
     * @returns The formatted metadata object
     */
    async fetchBookMetadata(ean: string): Promise<BookMetadata> {
        // The Google Books API uses 'isbn' for EAN/ISBN-13 search
        const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${ean}`;
        
        const response = await requestUrl({ url });
        const data = response.json;

        if (data.totalItems === 0 || !data.items?.[0]) {
            throw new Error(`No book found for EAN ${ean} on Google Books.`);
        }

        const volumeInfo = data.items[0].volumeInfo;

        // Data preparation
        const metadata: BookMetadata = {
            // Use empty strings or default values if fields are missing
            title: volumeInfo.title || 'Unknown Title',
            author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Unknown Author',
            publisher: volumeInfo.publisher || 'Unknown Publisher',
            pageCount: volumeInfo.pageCount || 0,
            publishedDate: volumeInfo.publishedDate || 'Unknown Date',
            // Google Books thumbnail URL, adjusted for better quality/size if possible
            // We use 'zoom=5' which is often suitable for ~300px width.
            coverUrl: volumeInfo.imageLinks?.thumbnail.replace('zoom=1', 'zoom=5') || 'No cover available',
        };

        return metadata;
    }

    /**
     * Updates the active note by writing the new metadata to the Frontmatter
     * @param file The note file to update
     * @param metadata The retrieved book data
     */
    async updateNoteWithMetadata(file: TFile, metadata: BookMetadata) {
        // Read the note's current content
        let content = await this.app.vault.read(file);
        
        // Find the boundary of the Frontmatter (the second '---' line)
        const fmEndMatchIndex = content.indexOf('---', content.indexOf('---') + 3);

        if (fmEndMatchIndex === -1) {
             // If the frontmatter is not found or malformed (only one '---' line or none)
             throw new Error('Frontmatter not found or malformed in the note.');
        }
        
        // Separate the Frontmatter block and the note content block
        const frontmatterBlock = content.substring(0, fmEndMatchIndex + 3);
        const contentBlock = content.substring(fmEndMatchIndex + 3).trimStart();
        
        // Lines to add or update in the Frontmatter
        const newFrontmatterLines = [
            `title: "${metadata.title.replace(/"/g, '\\"')}"`, // Escape quotes
            `author: "${metadata.author.replace(/"/g, '\\"')}"`,
            `editor: "${metadata.publisher.replace(/"/g, '\\"')}"`,
            `pages: ${metadata.pageCount}`,
            `published_date: "${metadata.publishedDate}"`,
        ];

        // Replace or add lines in the existing Frontmatter
        let newFrontmatter = frontmatterBlock;
        
        // Keys to look for and update
        const keysToUpdate = ['title', 'author', 'editor', 'pages', 'published_date'];

        for (const key of keysToUpdate) {
            // Regex to find the key and its current line value (multiline flag 'm')
            const regex = new RegExp(`^${key}:.*$`, 'm');
            const newLine = newFrontmatterLines.find(line => line.startsWith(key + ':'));

            if (newLine) {
                if (regex.test(newFrontmatter)) {
                    // Replace the existing line
                    newFrontmatter = newFrontmatter.replace(regex, newLine);
                } else {
                    // Add the new line just before the closing '---' line
                    // Simplified insertion: add before the last '---'
                    newFrontmatter = newFrontmatter.replace(/\n---$/, `\n${newLine}\n---`);
                }
            }
        }
        
        // --- 🖼️ Adding the Cover Image to the note body ---
        let imageMarkdown = `![Book Cover|300](${metadata.coverUrl})`;
        
        let finalContent: string;
        const imageRegex = /!\[.*?\|300\]\(.*\)/; // Regex to find an existing image markdown with size 300

        if (imageRegex.test(contentBlock)) {
            // If an image already exists, replace it
            finalContent = newFrontmatter + "\n" + contentBlock.replace(imageRegex, imageMarkdown).trim();
        } else {
             // If no image exists, add it at the top of the content block
             finalContent = newFrontmatter + "\n" + (imageMarkdown + "\n\n" + contentBlock).trim();
        }

        // Write the new content to the file
        await this.app.vault.modify(file, finalContent);
    }
}
