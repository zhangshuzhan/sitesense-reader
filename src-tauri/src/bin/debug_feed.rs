use rss_reader::feed::{FeedFetcher, FeedRequestOptions};
use std::env;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();

    // Default URL if not provided
    let url = if args.len() > 1 {
        &args[1]
    } else {
        "rsshub://bilibili/user/video/946974"
    };

    // Default mirror if not provided
    let mirror = if args.len() > 2 {
        Some(args[2].clone())
    } else {
        Some("https://rsshub.rssforever.com".to_string())
    };

    println!("Testing Feed Fetcher...");
    println!("Target URL: {}", url);
    println!("RSSHub Mirror: {:?}", mirror);
    println!("----------------------------------------");

    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in debug_feed");

    match fetcher
        .fetch_feed(
            url,
            FeedRequestOptions {
                rsshub_domain: mirror,
                etag: None,
                last_modified: None,
            },
        )
        .await
    {
        Ok(result) => {
            let Some(feed) = result.feed else {
                println!("No feed payload returned.");
                return;
            };
            println!("✅ SUCCESS!");
            println!("Feed Title: {}", feed.title);
            println!("Feed Description: {:?}", feed.description);
            println!("Found {} articles.", result.articles.len());
            if let Some(first) = result.articles.first() {
                println!("First Article: {}", first.title);
            }
        }
        Err(e) => {
            println!("❌ FAILED!");
            println!("Error: {}", e);
        }
    }
    println!("----------------------------------------");
}
