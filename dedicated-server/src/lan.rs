use axum::http::{uri::Authority, HeaderValue};
use std::net::{IpAddr, SocketAddr};

pub fn loopback_host(host: &HeaderValue) -> bool {
    let Some(authority) = host
        .to_str()
        .ok()
        .and_then(|host| host.parse::<Authority>().ok())
    else {
        return false;
    };
    let host = authority.host();
    host.trim_end_matches('.').eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.to_canonical().is_loopback())
}

pub fn addresses(listener: SocketAddr) -> Vec<String> {
    if !listener.ip().is_unspecified() {
        return Vec::new();
    }

    let mut addresses = interface_ips();
    addresses.retain(|ip| match ip {
        IpAddr::V4(ip) => listener.is_ipv4() && !ip.is_link_local() && !ip.is_broadcast(),
        IpAddr::V6(ip) => listener.is_ipv6() && !ip.is_unicast_link_local(),
    });
    addresses.retain(|ip| !ip.is_loopback() && !ip.is_unspecified() && !ip.is_multicast());
    addresses.sort_by_key(|ip| match ip {
        IpAddr::V4(ip) => !ip.is_private(),
        IpAddr::V6(ip) => !ip.is_unique_local(),
    });
    addresses
        .into_iter()
        .map(|ip| format!("http://{}", SocketAddr::new(ip, listener.port())))
        .collect()
}

#[cfg(unix)]
fn interface_ips() -> Vec<IpAddr> {
    let mut head = std::ptr::null_mut();
    let mut ips = Vec::new();
    // getifaddrs owns the list until freeifaddrs. Address families determine
    // the concrete sockaddr type, and null addresses have no IP to use.
    unsafe {
        if libc::getifaddrs(&mut head) != 0 {
            return ips;
        }
        let mut current = head;
        while let Some(interface) = current.as_ref() {
            current = interface.ifa_next;
            let flags = interface.ifa_flags as libc::c_int;
            let active = libc::IFF_UP | libc::IFF_RUNNING;
            if flags & active != active || flags & (libc::IFF_LOOPBACK | libc::IFF_POINTOPOINT) != 0
            {
                continue;
            }
            let Some(address) = interface.ifa_addr.as_ref() else {
                continue;
            };
            match address.sa_family.into() {
                libc::AF_INET => {
                    let address = &*interface.ifa_addr.cast::<libc::sockaddr_in>();
                    ips.push(address.sin_addr.s_addr.to_ne_bytes().into());
                }
                libc::AF_INET6 => {
                    let address = &*interface.ifa_addr.cast::<libc::sockaddr_in6>();
                    ips.push(address.sin6_addr.s6_addr.into());
                }
                _ => {}
            }
        }
        libc::freeifaddrs(head);
    }
    ips
}

#[cfg(not(unix))]
fn interface_ips() -> Vec<IpAddr> {
    Vec::new()
}
