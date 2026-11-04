//! Guards the repository Dockerfile, which Railway builds from `main`.
//! Railway rejects RUN mounts other than type=cache (deployment 841268e3 failed on a secret mount).

const DOCKERFILE: &str = include_str!("../../../Dockerfile");

#[test]
fn only_cache_mounts_which_railway_accepts() {
    for (index, _) in DOCKERFILE.match_indices("--mount=") {
        let mount: String = DOCKERFILE[index + "--mount=".len()..]
            .chars()
            .take_while(|c| !c.is_whitespace() && *c != '\\')
            .collect();
        assert!(
            mount.split(',').any(|part| part == "type=cache"),
            "Railway accepts only cache mounts: {mount}"
        );
    }
}

#[test]
fn images_are_pinned_and_the_runtime_is_distroless_non_root() {
    let froms: Vec<&str> = DOCKERFILE
        .lines()
        .filter_map(|line| line.strip_prefix("FROM "))
        .map(|rest| rest.split_whitespace().next().unwrap_or(""))
        .collect();
    assert_eq!(froms.len(), 2, "expected a build stage and a runtime stage");
    assert_eq!(froms[0], "rust:1.99.1-slim-trixie");
    assert!(
        froms[1].starts_with("gcr.io/distroless/cc-debian13:nonroot@sha256:"),
        "runtime image must be distroless nonroot pinned by digest, found {}",
        froms[1]
    );
    assert!(
        DOCKERFILE
            .lines()
            .any(|line| line.trim() == "USER 65532:65532")
    );
}
