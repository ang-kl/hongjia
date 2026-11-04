//! hongjia.org web server entry point.

use std::{env, io};
use tokio::{net::TcpListener, sync::watch};

#[tokio::main]
async fn main() -> io::Result<()> {
    let commit = hongjia_web::commit_label(env::var("RAILWAY_GIT_COMMIT_SHA").ok().as_deref());
    let ports = hongjia_web::listen_ports(
        env::var("PORT").ok().as_deref(),
        env::var("HONGJIA_ALSO_LISTEN").ok().as_deref(),
    );
    let app = hongjia_web::app(&commit);

    let (stop_tx, stop_rx) = watch::channel(false);
    tokio::spawn(async move {
        wait_for_shutdown().await;
        let _ = stop_tx.send(true);
    });

    let mut servers = Vec::new();
    for port in &ports {
        let listener = bind(*port).await?;
        let mut stop = stop_rx.clone();
        let app = app.clone();
        servers.push(tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = stop.wait_for(|stopped| *stopped).await;
                })
                .await
        }));
    }
    let list = ports
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    println!("hongjia web {commit} listening on {list}");

    for server in servers {
        server.await.map_err(io::Error::other)??;
    }
    Ok(())
}

/// Binds on all IPv6 and IPv4 addresses, falling back to IPv4 only where IPv6 is unavailable.
async fn bind(port: u16) -> io::Result<TcpListener> {
    match TcpListener::bind(("::", port)).await {
        Ok(listener) => Ok(listener),
        Err(_) => TcpListener::bind(("0.0.0.0", port)).await,
    }
}

async fn wait_for_shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
