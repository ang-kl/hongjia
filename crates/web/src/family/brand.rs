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

    /// A page's text as this site words it. The family's site keeps every word; on d4y the
    /// site's own sentences that speak of the family are reworded (whole phrases from the site's
    /// templates only, so nobody's document text is touched).
    pub fn reword(self, html: String) -> String {
        match self {
            Brand::Family => html,
            Brand::D4y => D4Y_WORDING
                .iter()
                .fold(html, |page, (from, to)| page.replace(from, to)),
        }
    }
}

/// The phrases d4y rewords (for the tests that keep them in step with the templates).
pub fn wording() -> &'static [(&'static str, &'static str)] {
    &D4Y_WORDING
}

/// The site's own phrases that name the family, and how d4y says them.
const D4Y_WORDING: [(&str, &str); 11] = [
    (
        r#"aria-label="Globe of the family documents""#,
        r#"aria-label="Globe of the documents""#,
    ),
    ("<label>Family password <input", "<label>Password <input"),
    (
        "This is a private site for four family profiles. Nothing here is shared outside the family,",
        "This is a private site for a small group. Nothing here is shared outside the group,",
    ),
    (
        "All four profiles can see this in the journal.",
        "Everyone signed in can see this in the journal.",
    ),
    ("<td>All four profiles", "<td>Everyone signed in"),
    ("the family sees one copy.", "everyone sees one copy."),
    ("Shared: one family copy", "Shared: one copy for everyone"),
    (
        "Hidden from the family's lists",
        "Hidden from everyone's lists",
    ),
    (
        "Hiding takes it off the family's lists",
        "Hiding takes it off everyone's lists",
    ),
    (
        "hidden from the family's lists",
        "hidden from everyone's lists",
    ),
    (
        "they cannot reach your account, the family's data or other pages",
        "they cannot reach your account, the site's data or other pages",
    ),
];
