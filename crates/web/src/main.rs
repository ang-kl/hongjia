//! hongjia.org web server entry point.
//!
//! Without `DATABASE_URL` the server is the P0 placeholder. With it, the server runs the database
//! migrations and serves family mode (sign-in, sessions, consent, journal).

use axum::Router;
use std::{env, io, net::SocketAddr, time::Duration};
use tokio::{net::TcpListener, sync::watch};

#[tokio::main]
async fn main() -> io::Result<()> {
    let commit = hongjia_web::commit_label(env::var("RAILWAY_GIT_COMMIT_SHA").ok().as_deref());
    let ports = hongjia_web::listen_ports(
        env::var("PORT").ok().as_deref(),
        env::var("HONGJIA_ALSO_LISTEN").ok().as_deref(),
    );

    let (app, mode) = match env::var("DATABASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        None => (hongjia_web::app(&commit), "placeholder"),
        // Until the family settings are complete (for example the family password is not set
        // yet), keep serving the placeholder rather than failing the deployment.
        Some(url) => match hongjia_web::family::Config::from_env(|key| env::var(key).ok()) {
            Err(e) => {
                eprintln!("family mode off: {e}");
                (hongjia_web::app(&commit), "placeholder")
            }
            Ok(_) => (family(&url, &commit).await?, "family"),
        },
    };

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
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
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
    println!("hongjia web {commit} ({mode} mode) listening on {list}");

    for server in servers {
        server.await.map_err(io::Error::other)??;
    }
    Ok(())
}

/// Connects (retrying for about a minute), migrates, and builds the family router. Also starts the
/// retention job: first run after one minute, then every six hours.
async fn family(url: &str, commit: &str) -> io::Result<Router> {
    let config = hongjia_web::family::Config::from_env(|key| env::var(key).ok())
        .map_err(|e| io::Error::other(format!("configuration error: {e}")))?;
    let mut attempt = 0;
    let pool = loop {
        attempt += 1;
        match sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(10))
            .connect(url)
            .await
        {
            Ok(pool) => break pool,
            Err(e) if attempt < 12 => {
                eprintln!("database not ready (attempt {attempt}): {e}");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            Err(e) => return Err(io::Error::other(format!("database unavailable: {e}"))),
        }
    };
    sqlx::migrate!("../../db/migrations")
        .run(&pool)
        .await
        .map_err(|e| io::Error::other(format!("migration failed: {e}")))?;
    let app = hongjia_web::family::app(pool.clone(), config, commit)
        .await
        .map_err(|e| io::Error::other(format!("startup failed: {e}")))?;
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            match hongjia_web::family::store::run_retention(&pool).await {
                Ok((sessions, locations, attempts)) => {
                    println!(
                        "retention: sessions {sessions}, locations {locations}, attempts {attempts}"
                    )
                }
                Err(e) => eprintln!("retention failed: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
    Ok(app)
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
