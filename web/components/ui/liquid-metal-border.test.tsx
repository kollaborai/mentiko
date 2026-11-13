import { render, waitFor } from "@testing-library/react";
import { LiquidMetalBorder } from "./liquid-metal-border";

const mockDispose = jest.fn();

jest.mock("@paper-design/shaders", () => ({
  ShaderMount: jest.fn().mockImplementation(() => ({
    dispose: mockDispose,
    canvasElement: { style: {} },
  })),
  liquidMetalFragmentShader: "mock-fragment-shader",
}));

describe("LiquidMetalBorder", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: false }),
    });
    mockDispose.mockClear();
    (jest.requireMock("@paper-design/shaders") as { ShaderMount: jest.Mock })
      .ShaderMount.mockClear();
  });

  it("disposes the shader mount when the component unmounts", async () => {
    const { unmount } = render(
      <LiquidMetalBorder>
        <span>Login</span>
      </LiquidMetalBorder>,
    );
    const { ShaderMount } = jest.requireMock("@paper-design/shaders") as {
      ShaderMount: jest.Mock;
    };

    await waitFor(() => expect(ShaderMount).toHaveBeenCalledTimes(1));
    unmount();

    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
