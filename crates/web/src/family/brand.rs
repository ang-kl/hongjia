//! Which site a request is for. One server answers two sites (the owner, 20 November 2026): the
//! family's own, and d4y for friends. Each site keeps its own tables, settings and name; the words
//! a page shows (its name, and "family") follow the site the request arrived on, so a d4y page
//! never names the other site.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Brand {
    Family,
    D4y,
}

tokio::task_local! {
    static BRAND: Brand;
}

/// The site of the request being served. Outside a request (tests that render a page directly)
/// it is the family's site.
pub fn current() -> Brand {
    BRAND.try_with(|b| *b).unwrap_or(Brand::Family)
}

/// Runs `fut` (a request) as a request for `brand`'s site.
pub async fn scope<F: std::future::Future>(brand: Brand, fut: F) -> F::Output {
    BRAND.scope(brand, fut).await
}

impl Brand {
    /// The name at the top of each page (trusted HTML).
    pub fn name_html(self) -> &'static str {
        match self {
            Brand::Family => r#"<span lang="zh">洪家</span> · hongjia"#,
            Brand::D4y => "D4Y · Discover, 4 Lens, Yield",
        }
    }

    /// The short name after each page title in the browser tab.
    pub fn tab(self) -> &'static str {
        match self {
            Brand::Family => "hongjia",
            Brand::D4y => "D4Y",
        }
    }

    /// The `data-brand` value on each page's body, for the page scripts.
    pub fn code(self) -> &'static str {
        match self {
            Brand::Family => "family",
            Brand::D4y => "d4y",
        }
    }

    /// The family's site's words, or d4y's. Each template passes both, so a d4y page never
    /// carries the family's wording, and nobody's own text is touched.
    pub fn say(self, family: &'static str, d4y: &'static str) -> &'static str {
        match self {
            Brand::Family => family,
            Brand::D4y => d4y,
        }
    }
}
