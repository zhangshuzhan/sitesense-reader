use super::{FeedFetcher, FeedRequestOptions};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn test_fetch_feed_success() {
    let mock_server = MockServer::start().await;

    let rss_content = r#"
            <?xml version="1.0" encoding="UTF-8" ?>
            <rss version="2.0">
            <channel>
                <title>Test Feed</title>
                <link>http://example.com</link>
                <description>Test Description</description>
                <item>
                    <title>Test Article</title>
                    <link>http://example.com/article</link>
                    <description>Test Article Description</description>
                </item>
            </channel>
            </rss>
        "#;

    Mock::given(method("GET"))
        .and(path("/feed.xml"))
        .respond_with(ResponseTemplate::new(200).set_body_string(rss_content))
        .mount(&mock_server)
        .await;

    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in test");
    let url = format!("{}/feed.xml", mock_server.uri());
    let result = fetcher
        .fetch_feed(
            &url,
            FeedRequestOptions {
                rsshub_domain: None,
                etag: None,
                last_modified: None,
            },
        )
        .await;

    assert!(result.is_ok());
    let result = result.unwrap();
    let feed = result.feed.unwrap();
    let articles = result.articles;
    assert_eq!(feed.title, "Test Feed");
    assert_eq!(articles.len(), 1);
    assert_eq!(articles[0].title, "Test Article");
}

#[tokio::test]
async fn test_fetch_feed_404() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/404.xml"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&mock_server)
        .await;

    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in test");
    let url = format!("{}/404.xml", mock_server.uri());
    let result = fetcher
        .fetch_feed(
            &url,
            FeedRequestOptions {
                rsshub_domain: None,
                etag: None,
                last_modified: None,
            },
        )
        .await;

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("HTTP 404"));
}

#[tokio::test]
async fn test_fetch_feed_500() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/500.xml"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;

    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in test");
    let url = format!("{}/500.xml", mock_server.uri());
    let result = fetcher
        .fetch_feed(
            &url,
            FeedRequestOptions {
                rsshub_domain: None,
                etag: None,
                last_modified: None,
            },
        )
        .await;

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("HTTP 500"));
}

#[tokio::test]
async fn test_fetch_feed_parse_error() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/invalid.xml"))
        .respond_with(ResponseTemplate::new(200).set_body_string("Invalid XML"))
        .mount(&mock_server)
        .await;

    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in test");
    let url = format!("{}/invalid.xml", mock_server.uri());
    let result = fetcher
        .fetch_feed(
            &url,
            FeedRequestOptions {
                rsshub_domain: None,
                etag: None,
                last_modified: None,
            },
        )
        .await;

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("Failed to parse feed"));
}

#[tokio::test]
async fn test_fetch_feed_connection_error() {
    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in test");
    // Use a port that is unlikely to be open
    let url = "http://127.0.0.1:12345/feed.xml";
    let result = fetcher
        .fetch_feed(
            url,
            FeedRequestOptions {
                rsshub_domain: None,
                etag: None,
                last_modified: None,
            },
        )
        .await;

    assert!(result.is_err());
    let err = result.unwrap_err();
    // Verify it contains connection error details
    assert!(err.contains("Failed to fetch feed"));
}

#[tokio::test]
async fn test_rsshub_domain_replacement() {
    let mock_server = MockServer::start().await;

    let rss_content = r#"
            <?xml version="1.0" encoding="UTF-8" ?>
            <rss version="2.0">
            <channel>
                <title>RSSHub Feed</title>
                <link>http://example.com</link>
                <description>RSSHub Description</description>
            </channel>
            </rss>
        "#;

    // Expect request to the mock server with the path extracted from rsshub:// URL
    Mock::given(method("GET"))
        .and(path("/bilibili/user/video/123"))
        .respond_with(ResponseTemplate::new(200).set_body_string(rss_content))
        .mount(&mock_server)
        .await;

    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in test");
    // Use rsshub:// protocol
    let url = "rsshub://bilibili/user/video/123";
    // Pass mock server URL as the custom domain
    let rsshub_domain = Some(mock_server.uri());

    let result = fetcher
        .fetch_feed(
            url,
            FeedRequestOptions {
                rsshub_domain,
                etag: None,
                last_modified: None,
            },
        )
        .await;

    assert!(result.is_ok());
    let feed = result.unwrap().feed.unwrap();
    assert_eq!(feed.title, "RSSHub Feed");
}

#[tokio::test]
async fn test_fetch_feed_sends_condition_headers_and_handles_304() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/cached.xml"))
        .respond_with(
            ResponseTemplate::new(304)
                .insert_header("etag", "\"abc\"")
                .insert_header("last-modified", "Wed, 21 Oct 2015 07:28:00 GMT"),
        )
        .mount(&mock_server)
        .await;

    let fetcher = FeedFetcher::new().expect("Failed to build HTTP client in test");
    let url = format!("{}/cached.xml", mock_server.uri());
    let result = fetcher
        .fetch_feed(
            &url,
            FeedRequestOptions {
                rsshub_domain: None,
                etag: Some("\"abc\"".to_string()),
                last_modified: Some("Wed, 21 Oct 2015 07:28:00 GMT".to_string()),
            },
        )
        .await
        .expect("304 response should be handled as a successful cache hit");

    assert!(result.not_modified);
    assert!(result.feed.is_none());
    assert!(result.articles.is_empty());
    assert_eq!(result.etag.as_deref(), Some("\"abc\""));
    assert_eq!(
        result.last_modified.as_deref(),
        Some("Wed, 21 Oct 2015 07:28:00 GMT")
    );

    let requests = mock_server
        .received_requests()
        .await
        .expect("wiremock should record requests");
    let request = requests.first().expect("expected one request");
    assert_eq!(
        request
            .headers
            .get("if-none-match")
            .and_then(|value| value.to_str().ok()),
        Some("\"abc\"")
    );
    assert_eq!(
        request
            .headers
            .get("if-modified-since")
            .and_then(|value| value.to_str().ok()),
        Some("Wed, 21 Oct 2015 07:28:00 GMT")
    );
}
