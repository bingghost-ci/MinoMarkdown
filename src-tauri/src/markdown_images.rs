use percent_encoding::percent_decode_str;
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use std::{collections::{HashMap, HashSet}, ops::Range, path::PathBuf};

fn options() -> Options { Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH }

fn is_reference(link_type: LinkType) -> bool {
    matches!(link_type, LinkType::Reference | LinkType::Collapsed | LinkType::Shortcut)
}

fn image_destinations(markdown: &str) -> Vec<(String, Range<usize>)> {
    Parser::new_ext(markdown, options()).into_offset_iter().filter_map(|(event, range)| {
        if let Event::Start(Tag::Image { dest_url, .. }) = event { Some((dest_url.into_string(), range)) } else { None }
    }).collect()
}

pub fn local_asset_path(url: &str) -> Option<PathBuf> {
    let raw = url.strip_prefix("./").unwrap_or(url);
    if !raw.starts_with("assets/") { return None; }
    let decoded = percent_decode_str(raw).decode_utf8().ok()?;
    let mut parts = decoded.split('/');
    let folder = parts.next()?;
    let name = parts.next()?;
    if folder != "assets" || name.is_empty() || name == "." || name == ".." || name.contains(['\\', '\0']) || parts.next().is_some() { return None; }
    Some(PathBuf::from(decoded.as_ref()))
}

pub fn referenced_assets(markdown: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    image_destinations(markdown).into_iter().filter_map(|(url, _)| {
        if local_asset_path(&url).is_some() && seen.insert(url.clone()) { Some(url) } else { None }
    }).collect()
}

pub fn image_urls(markdown: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    image_destinations(markdown).into_iter().filter_map(|(url, _)| if seen.insert(url.clone()) { Some(url) } else { None }).collect()
}

pub fn rewrite_image_urls(markdown: &str, replacements: &HashMap<String, String>) -> Result<String, String> {
    if replacements.is_empty() { return Ok(markdown.into()); }
    let parser = Parser::new_ext(markdown, options());
    let definitions: HashMap<String, (String, Range<usize>)> = parser.reference_definitions().iter()
        .map(|(id, definition)| (id.to_lowercase(), (definition.dest.to_string(), definition.span.clone()))).collect();
    let mut edits: Vec<(Range<usize>, String)> = Vec::new();
    let mut found = HashSet::new();
    let mut edited_definitions = HashSet::new();
    let mut linked_definitions = HashSet::new();
    let mut images = Vec::new();
    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::Image { link_type, dest_url, id, .. }) => images.push((dest_url.into_string(), range, if is_reference(link_type) { Some(id.to_lowercase()) } else { None })),
            Event::Start(Tag::Link { link_type, id, .. }) if is_reference(link_type) => { linked_definitions.insert(id.to_lowercase()); },
            _ => {}
        }
    }
    for (url, range, reference_id) in images {
        let Some(new_url) = replacements.get(&url) else { continue };
        let (slice, base, offset) = if let Some(id) = reference_id {
            if linked_definitions.contains(&id) { return Err("INVALID_ASSET".into()); }
            if !edited_definitions.insert(id.clone()) { found.insert(url); continue; }
            let (defined_url, span) = definitions.get(&id).ok_or("INVALID_ASSET")?;
            if defined_url != &url { return Err("INVALID_ASSET".into()); }
            let slice = markdown.get(span.clone()).ok_or("INVALID_ASSET")?;
            let label_end = slice.find("]:").ok_or("INVALID_ASSET")? + 2;
            let offset = slice[label_end..].find(&url).ok_or("INVALID_ASSET")? + label_end;
            (slice, span.start, offset)
        } else {
            let slice = markdown.get(range.clone()).ok_or("INVALID_ASSET")?;
            let destination = slice.find("](").ok_or("INVALID_ASSET")? + 2;
            let after_open = &slice[destination..];
            let padding = after_open.len() - after_open.trim_start_matches([' ', '\t', '\n']).len();
            let after_padding = &after_open[padding..];
            let bracket = usize::from(after_padding.starts_with('<'));
            (slice, range.start, destination + padding + bracket)
        };
        if !slice[offset..].starts_with(&url) { return Err("INVALID_ASSET".into()); }
        let start = base + offset;
        edits.push((start..start + url.len(), new_url.clone()));
        found.insert(url);
    }
    if found.len() != replacements.len() { return Err("INVALID_ASSET".into()); }
    edits.sort_by(|a,b| b.0.start.cmp(&a.0.start));
    let mut output = markdown.to_owned();
    for (range, value) in edits { output.replace_range(range, &value); }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rewrites_only_image_destinations_and_keeps_code_and_text() {
        let markdown = "`blob:one`\n\n![blob:one](blob:one \"blob:one\")\n\n```md\n![x](blob:one)\n```\n\n![two](blob:one)\n";
        let result = rewrite_image_urls(markdown, &HashMap::from([("blob:one".into(), "assets/image.png".into())])).unwrap();
        assert!(result.contains("`blob:one`"));
        assert!(result.contains("![blob:one](assets/image.png \"blob:one\")"));
        assert!(result.contains("```md\n![x](blob:one)\n```"));
        assert!(result.contains("![two](assets/image.png)"));
    }
    #[test]
    fn collects_only_image_assets() {
        assert_eq!(referenced_assets("[link](assets/no.md) ![x](assets/one.png) `![x](assets/no.png)`"), vec!["assets/one.png"]);
    }
    #[test]
    fn reference_image_and_encoded_path_rewrite_without_changing_link() {
        let markdown = "[link][ref] ![图][pic]\n\n[ref]: https://example.org/path\n[pic]: ./assets/中文%20图片%23%25%28a%29.png \"标题\"";
        let old = "./assets/中文%20图片%23%25%28a%29.png";
        assert_eq!(image_urls(markdown), vec![old]);
        assert_eq!(local_asset_path(old).unwrap(), PathBuf::from("assets/中文 图片#%(a).png"));
        let rewritten = rewrite_image_urls(markdown, &HashMap::from([(old.into(), "assets/image.png".into())])).unwrap();
        assert!(rewritten.contains("[ref]: https://example.org/path"));
        assert!(rewritten.contains("[pic]: assets/image.png \"标题\""));
    }
    #[test]
    fn shared_definition_or_encoded_traversal_is_rejected() {
        let markdown = "[link][both] ![图][both]\n\n[both]: assets/one.png";
        assert!(rewrite_image_urls(markdown, &HashMap::from([("assets/one.png".into(), "blob:image".into())])).is_err());
        assert!(local_asset_path("assets/%2e%2e%2fsecret.png").is_none());
    }
    #[test]
    fn rewrites_angle_bracket_and_spaced_image_destinations() {
        let markdown = "![图](<assets/中文 图片.png> \"标题\")\n\n![另图](  assets/a.png \"说明\")";
        let rewritten = rewrite_image_urls(markdown, &HashMap::from([
            ("assets/中文 图片.png".into(), "assets/new.png".into()),
            ("assets/a.png".into(), "assets/b.png".into()),
        ])).unwrap();
        assert_eq!(rewritten, "![图](<assets/new.png> \"标题\")\n\n![另图](  assets/b.png \"说明\")");
    }
}
