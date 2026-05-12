"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  BoxFilled,
  RotateFilled,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";

interface DockerSetupProps {
  onComplete: (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => void;
  onBack: () => void;
}

interface DockerContainer {
  name: string;
  image: string;
  status: string;
  id: string;
}

type Mode = "existing" | "new";

export function DockerSetup({ onComplete, onBack }: DockerSetupProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [mode, setMode] = useState<Mode>("existing");
  const [dockerAvailable, setDockerAvailable] = useState(true);

  // existing container
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState("");
  const [loadingContainers, setLoadingContainers] = useState(false);

  // new container
  const [image, setImage] = useState("ubuntu:22.04");
  const [containerName, setContainerName] = useState("");

  // shared
  const [workdir, setWorkdir] = useState("/workspace");
  const [user, setUser] = useState("");
  const [name, setName] = useState("");
  const [nameManual, setNameManual] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const derivedName = nameManual
    ? name
    : mode === "existing"
      ? selectedContainer
      : containerName;

  const handleNameChange = (val: string) => {
    setName(val);
    setNameManual(true);
  };

  // load containers
  useEffect(() => {
    const load = async () => {
      setLoadingContainers(true);
      try {
        const res = await fetchWithNamespace(
          "/api/workspaces/provision/docker"
        );
        const data = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          containers?: DockerContainer[];
          hint?: string;
        };
        if (res.ok) {
          setDockerAvailable(data.available !== false);
          setContainers(data.containers || []);
          if (data.containers && data.containers.length > 0) {
            setSelectedContainer(data.containers[0].name);
            if (!nameManual) setName(data.containers[0].name);
          } else {
            setMode("new");
          }
        }
      } catch {
        setDockerAvailable(false);
      } finally {
        setLoadingContainers(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWithNamespace]);

  const handleSubmitExisting = useCallback(async () => {
    if (!selectedContainer) {
      setError("select a container");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const wsName = derivedName || selectedContainer;
      const res = await fetchWithNamespace("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wsName,
          path: workdir,
          execution: {
            type: "docker",
            docker: {
              container: selectedContainer,
              path: workdir,
              user: user.trim() || undefined,
            },
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        workspace?: { id?: string };
      };

      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to create workspace"));
        return;
      }

      onComplete({
        workspaceId: data.workspace?.id || wsName,
        workspaceName: wsName,
        workspacePath: workdir,
        method: "docker",
      });
    } catch {
      setError("failed to create workspace");
    } finally {
      setCreating(false);
    }
  }, [selectedContainer, derivedName, workdir, user, fetchWithNamespace, onComplete]);

  const handleSubmitNew = useCallback(async () => {
    if (!containerName.trim()) {
      setError("container name is required");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const res = await fetchWithNamespace(
        "/api/workspaces/provision/docker",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: containerName.trim(),
            image: image.trim() || "ubuntu:22.04",
            workspacePath: workdir,
            createWorkspace: true,
          }),
        }
      );

      const data = (await res.json().catch(() => ({}))) as {
        container?: { containerName?: string; workspacePath?: string };
        workspace?: { id?: string; name?: string };
      };

      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to provision container"));
        return;
      }

      const wsName = derivedName || data.workspace?.name || containerName.trim();
      const wsPath = data.container?.workspacePath || workdir;

      onComplete({
        workspaceId: data.workspace?.id || wsName,
        workspaceName: wsName,
        workspacePath: wsPath,
        method: "docker",
      });
    } catch {
      setError("failed to provision container");
    } finally {
      setCreating(false);
    }
  }, [containerName, image, workdir, derivedName, fetchWithNamespace, onComplete]);

  const handleSubmit = mode === "existing" ? handleSubmitExisting : handleSubmitNew;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Docker container</h2>
        <p className="text-sm text-foreground/50">
          run agents inside a Docker container
        </p>
      </div>

      {!dockerAvailable && (
        <div className="bg-muted/30 rounded-md px-3 py-2 text-xs text-foreground/50">
          Docker daemon not running or not installed. Start Docker and try
          again.
        </div>
      )}

      {dockerAvailable && (
        <>
          {/* mode toggle */}
          <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5 w-fit mx-auto">
            {([
              { key: "existing" as const, label: "Existing container" },
              { key: "new" as const, label: "Create new" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setError("");
                }}
                className={`px-3 py-1.5 rounded text-xs transition-colors ${
                  mode === key
                    ? "bg-background text-foreground"
                    : "text-foreground/40 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "existing" && (
            <div className="space-y-4">
              {loadingContainers ? (
                <div className="flex items-center gap-2 text-xs text-foreground/40">
                  <RotateFilled className="h-3 w-3 animate-spin" />
                  loading containers...
                </div>
              ) : containers.length === 0 ? (
                <div className="text-xs text-foreground/40 text-center py-3">
                  no running containers found.{" "}
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className="text-foreground/60 hover:text-foreground underline transition-colors"
                  >
                    create one
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs text-foreground/50">
                    Container
                  </label>
                  <select
                    value={selectedContainer}
                    onChange={(e) => {
                      setSelectedContainer(e.target.value);
                      if (!nameManual) setName(e.target.value);
                    }}
                    className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent"
                  >
                    {containers.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.image}) - {c.status}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {mode === "new" && (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-foreground/50">Image</label>
                <input
                  type="text"
                  placeholder="ubuntu:22.04"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-foreground/50">
                  Container name
                </label>
                <input
                  type="text"
                  placeholder="my-container"
                  value={containerName}
                  onChange={(e) => {
                    setContainerName(e.target.value);
                    if (!nameManual) setName(e.target.value);
                  }}
                  className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* working directory */}
          <div className="space-y-1">
            <label className="text-xs text-foreground/50">
              Working directory
            </label>
            <input
              type="text"
              placeholder="/workspace"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
            />
          </div>

          {/* user */}
          <div className="space-y-1">
            <label className="text-xs text-foreground/50">
              User <span className="text-foreground/30">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="root"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
            />
          </div>

          {/* workspace name */}
          <div className="space-y-1">
            <label className="text-xs text-foreground/50">
              Workspace name
            </label>
            <input
              type="text"
              placeholder="derived from container"
              value={derivedName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent placeholder:text-foreground/20"
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          back
        </button>
        <Button
          onClick={handleSubmit}
          disabled={
            creating ||
            !dockerAvailable ||
            (mode === "existing" && !selectedContainer) ||
            (mode === "new" && !containerName.trim())
          }
          className="gap-2"
        >
          {creating ? (
            <>
              <RotateFilled className="h-4 w-4 animate-spin" />
              {mode === "new" ? "provisioning..." : "creating..."}
            </>
          ) : (
            <>
              {mode === "new" ? "provision & create" : "create workspace"}
              <BoxFilled className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
