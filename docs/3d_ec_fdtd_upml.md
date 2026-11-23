# 3D Equivalent Circuit Finite Difference Time Domain UPML
## Tensor frequency domain form of Maxwell's equation
### Fourier transform
Taking Fourier transform of Maxwell's equations gives the following.

$$
\begin{align}
\nabla \times \vec{H} &= j \omega \varepsilon \vec{E} \\
\nabla \times \vec{E} &= - j \omega \mu \vec{H} \\
\end{align}
$$

### Tensor form
In tensor form this takes the following form.

$$
% H-field
\begin{align}
\begin{bmatrix}
0 & -\frac{\delta}{\delta z} & \frac{\delta}{\delta y} \\
\frac{\delta}{\delta z} & 0 & -\frac{\delta}{\delta x} \\
-\frac{\delta}{\delta y} & \frac{\delta}{\delta x} & 0 \\
\end{bmatrix}
\begin{bmatrix} H_x \\ H_y \\ H_z \\ \end{bmatrix}
&= j \omega
\begin{bmatrix}
\varepsilon_{xx} & \varepsilon_{xy} & \varepsilon_{xz} \\
\varepsilon_{yx} & \varepsilon_{yy} & \varepsilon_{yz} \\
\varepsilon_{zx} & \varepsilon_{zy} & \varepsilon_{zz} \\
\end{bmatrix}
\begin{bmatrix} E_x \\ E_y \\ E_z \\ \end{bmatrix} \\
% E-field
\begin{bmatrix}
0 & -\frac{\delta}{\delta z} & \frac{\delta}{\delta y} \\
\frac{\delta}{\delta z} & 0 & -\frac{\delta}{\delta x} \\
-\frac{\delta}{\delta y} & \frac{\delta}{\delta x} & 0 \\
\end{bmatrix}
\begin{bmatrix} E_x \\ E_y \\ E_z \\ \end{bmatrix}
&= -j \omega
\begin{bmatrix}
\mu_{xx} & \mu_{xy} & \mu_{xz} \\
\mu_{yx} & \mu_{yy} & \mu_{yz} \\
\mu_{zx} & \mu_{zy} & \mu_{zz} \\
\end{bmatrix}
\begin{bmatrix} H_x \\ H_y \\ H_z \\ \end{bmatrix} \\
\end{align}
$$

## Antistropic and isotropic materials
The coefficients in the tensors for $\mu$ and $\varepsilon$ vary depending on whether it is isotropic, uniaxial or biaxial.

$$
\begin{align}
& \begin{bmatrix}
\varepsilon_a & 0 & 0 \\
0 & \varepsilon_a & 0 \\
0 & 0 & \varepsilon_a \\
\end{bmatrix} \qquad \text{(isotropic)} \\
& \begin{bmatrix}
\varepsilon_a & 0 & 0 \\
0 & \varepsilon_a & 0 \\
0 & 0 & \varepsilon_b \\
\end{bmatrix} \qquad \text{(uniaxial anisotropic)} \\
& \begin{bmatrix}
\varepsilon_a & 0 & 0 \\
0 & \varepsilon_b & 0 \\
0 & 0 & \varepsilon_c \\
\end{bmatrix} \qquad \text{(biaxial anisotropic)} \\
\end{align}
$$

### Complex permittivity
Permittivity is a complex number with a real and imaginary component, such that $\varepsilon = \varepsilon^{'} -j \varepsilon^{''}$.

The resulting electric displacement will vary by magnitude and phase in response to the applied electric field depending on the permittivity of the material.

$$\vec{D} = \varepsilon \vec{E} = (\varepsilon^{'} -j \varepsilon^{''}) \vec{E}$$

The real component is in phase with the applied electric field which corresponds to energy storage in the form of in phase polarisation of bound charges in the material.
- **Electronic polarisation**: Electron cloud of atoms shifts relative to atom's nucleus when an electric field is applied.
- **Ionic atomic polarisation**: Cations move to the negative side of the electric field, and the anions move to the positive side of the field creating induced dipoles.
- **Dipole polarisation**: Permanent dipoles like water molecules rotate and align with the electric field.
- **Interfacial polarisation**: Charges build up at grain boundaries within a material.

In comparison the imaginary component is that is out of phase with the applied electric field which corresponds to energy loss in the form of lagging out of phase polarisation of charges which is dissipated as Joule heating. This is always lagging since the charges cannot move before the electric field is applied which is why it the complex term is negative.
- **Conduction losses**: Free charge carriers drifting and scattering which contributes to $\frac{\sigma_{free}^E}{\omega}$.
- **Dipole relaxation**: Bound charges like dipoles experience friction when rotating causing energy loss, the same mechanism as microwaves heating water molecules which contributes to $\varepsilon^{''}_{bound}$.

$$
\begin{align}
\varepsilon^{'} &= \varepsilon^{'}_{bound} \\
\varepsilon^{''} &= \frac{\sigma_{free}^E}{\omega} + \varepsilon^{''}_{bound} \\
\varepsilon &= \varepsilon^{'}_{bound} -j\frac{\sigma_{free}^E}{\omega} - j\varepsilon^{''}_{bound} \\
\end{align}
$$

The electrical loss tangent is the ratio of the imaginary component against the real components which corresponds to the ratio between energy loss against the energy stored.

The electric displacement will vary by magnitude and phase in response to the applied electric field depending on the permittivity of the material the electric field is passing throgh.

$$\vec{D} = \varepsilon \vec{E} = (\varepsilon^{'} -j \varepsilon^{''}) \vec{E}$$

$$
\tan(\delta) = \frac{\varepsilon^{''}}{\varepsilon^{'}}
$$

Normally the energy loss due to bound charges is ignored since it is comparatively small relative to energy stored by bound charges and energy lost from free charges, which includes circuit simulations. The permittivity can by therefore be simplified to

$$
\varepsilon = \varepsilon^{'}_{bound} + \frac{\sigma_{free}^E}{j\omega} \\
$$

### Complex permeability
Likewise the permeability of a material can also be written as a complex value $\mu = \mu^{'} - j\mu^{''}$.

The resulting magnetic flux density will vary by magnitude and phase in response to the applied magnetic field depending on the permeability of the material.

$$\vec{B} = \mu \vec{H} = (\mu^{'} - j\mu^{''})\vec{H}$$

The real component is in phase with the magnetic field which corresponds to energy storage in the form of magnetic moments.
- **Magnetic domains**: Alignment of magnetic domains in ferromagnetic material.
- **Electron spin**: The intrinsic angular momentum called spin $\frac{h}{2}$ which is a quantum property that makes an electron behave like a tiny bar magnet. Most materials have electron pairs which pair up in filled orbitals with opposite spins which cancels out the magnetic moments. Materials which have unpaired electrons such as iron, cobalt and nickel therefore have magnetic moments from unpaired electrons.
- **Orbital moment**: An electron cloud carries a circulating probability current which produces a magnetic moment.

The imaginary component is lagging behind the magnetic field which corresponds to energy loss in the form of Joule heating.
- **Hysteresis**: Irreversible domain wall motion and rotation arising from crystal defects, impurities, dislocations, grain boundaries and internal stresses.
- **Eddy currents**: An oscillating magnetic field induces eddy currents which then experience conduction losses resultig in Joule heating.
- **Domain wall resonance and relaxation**: Domain walls have inertia and damping which results in the magnetic moments lagging behind the applied magnetic field especially as frequency increases.

Technically since magnetic monopoles do not exist $\sigma^M = 0$, however for metamaterials or mathematical only materials we can let this value be finite, such as in the derivation of a perfectly matched layer (PML) in an FDTD simulation.

$$
\mu = \mu^{'} - j\frac{\sigma^M}{\omega} - j\mu^{''}
$$

The magnetic loss tangent is the ratio of the imaginary component against the real components which corresponds to the ratio between energy loss against the energy stored.

$$
\tan(\delta) = \frac{\mu^{''}}{\mu^{'}}
$$

### Maxwell's equations in tensor form with biaxial anisotropic material
The tensor form including complex permittivity and complex permeability with biaxial anisotropic materials thus appears as

$$
% H-field
\begin{align}
\begin{bmatrix}
0 & -\frac{\delta}{\delta z} & \frac{\delta}{\delta y} \\
\frac{\delta}{\delta z} & 0 & -\frac{\delta}{\delta x} \\
-\frac{\delta}{\delta y} & \frac{\delta}{\delta x} & 0 \\
\end{bmatrix}
\begin{bmatrix} H_x \\ H_y \\ H_z \\ \end{bmatrix}
&= j \omega
\begin{bmatrix}
\varepsilon_{x} + \frac{\sigma_x^E}{j\omega} & 0 & 0 \\
0 & \varepsilon_{y} + \frac{\sigma_y^E}{j\omega} & 0  \\
0 & 0 & \varepsilon_{z} + \frac{\sigma_z^E}{j\omega} \\
\end{bmatrix}
\begin{bmatrix} E_x \\ E_y \\ E_z \\ \end{bmatrix} \\
% E-field
\begin{bmatrix}
0 & -\frac{\delta}{\delta z} & \frac{\delta}{\delta y} \\
\frac{\delta}{\delta z} & 0 & -\frac{\delta}{\delta x} \\
-\frac{\delta}{\delta y} & \frac{\delta}{\delta x} & 0 \\
\end{bmatrix}
\begin{bmatrix} E_x \\ E_y \\ E_z \\ \end{bmatrix}
&= - j \omega
\begin{bmatrix}
\mu_{x} + \frac{\sigma_x^M}{j\omega} & 0 & 0 \\
0 & \mu_{y} + \frac{\sigma_y^M}{j\omega} & 0  \\
0 & 0 & \mu_{z} + \frac{\sigma_z^M}{j\omega} \\
\end{bmatrix}
\begin{bmatrix} H_x \\ H_y \\ H_z \\ \end{bmatrix} \\
\end{align}
$$

## Defining a perfectly matched layer
Firstly consider a rudimentary absorbing boundary that has increasing loss to absorb incoming waves. This is not a perfect absorbing boundary since the change in impedance as an electromagnetic wave enters it results in reflections.
To have both a lossy region and impedance matching we adjust complex permittivity and complex permeability to be impedance matched at all frequencies and directions. Increase $\varepsilon^{''}$ to add loss and change $\varepsilon^{'}$ to maintain constant impedance.

### Relative complex permittivity and permeability
Consider the relative complex permittivity and relative complex permeability for a biaxial anisotropic material.
$$
% Permittivity
\begin{align}
\boldsymbol{\varepsilon} &=
\begin{bmatrix}
\varepsilon_{x} + \frac{\sigma_x^E}{j\omega} & 0 & 0 \\
0 & \varepsilon_{y} + \frac{\sigma_y^E}{j\omega} & 0  \\
0 & 0 & \varepsilon_{z} + \frac{\sigma_z^E}{j\omega} \\
\end{bmatrix}
= \varepsilon_0
\begin{bmatrix}
\varepsilon_{r,x} + \frac{\sigma_x^E}{j\omega\varepsilon_0} & 0 & 0 \\
0 & \varepsilon_{r,y} + \frac{\sigma_y^E}{j\omega\varepsilon_0} & 0  \\
0 & 0 & \varepsilon_{r,z} + \frac{\sigma_z^E}{j\omega\varepsilon_0} \\
\end{bmatrix} \\
% Permeability
\boldsymbol{\mu} &=
\begin{bmatrix}
\mu_{x} + \frac{\sigma_x^M}{j\omega} & 0 & 0 \\
0 & \mu_{y} + \frac{\sigma_y^M}{j\omega} & 0  \\
0 & 0 & \mu_{z} + \frac{\sigma_z^M}{j\omega} \\
\end{bmatrix}
= \mu_0
\begin{bmatrix}
\mu_{r,x} + \frac{\sigma_x^M}{j\omega\mu_0} & 0 & 0 \\
0 & \mu_{r,y} + \frac{\sigma_y^M}{j\omega\mu_0} & 0  \\
0 & 0 & \mu_{r,z} + \frac{\sigma_z^M}{j\omega\mu_0} \\
\end{bmatrix}
\end{align} \\
$$

Therefore we can define the relative complex permittivity and permeability as
$$
\begin{align}
\boldsymbol{\varepsilon_{r,pml}} &= 
\begin{bmatrix}
\varepsilon_{r,x} + \frac{\sigma_x^E}{j\omega\varepsilon_0} & 0 & 0 \\
0 & \varepsilon_{r,y} + \frac{\sigma_y^E}{j\omega\varepsilon_0} & 0  \\
0 & 0 & \varepsilon_{r,z} + \frac{\sigma_z^E}{j\omega\varepsilon_0} \\
\end{bmatrix} \\
\boldsymbol{\mu_{r,pml}} &=
\begin{bmatrix}
\mu_{r,x} + \frac{\sigma_x^M}{j\omega\mu_0} & 0 & 0 \\
0 & \mu_{r,y} + \frac{\sigma_y^M}{j\omega\mu_0} & 0  \\
0 & 0 & \mu_{r,z} + \frac{\sigma_z^M}{j\omega\mu_0} \\
\end{bmatrix}
\end{align}
$$

### Impedance matching PML with isotropic external material
To match the impedance of the region outside the PML it has to be equal to the intrinsic impedance of the medium usually free space to prevent energy being reflected.

$$
\begin{align}
\eta &= \sqrt{\frac{\mu}{\varepsilon}} \\
\eta &= \sqrt{\frac{\mu_0\mu_r}{\varepsilon_0\varepsilon_r}} \\
\eta &= \eta_0 \sqrt{\frac{\mu_r}{\varepsilon_r}} \\
\end{align}
$$

Since the PML is an anisotropic material along axis $i$ the permittivity and permeability are complex tensors $\boldsymbol{\varepsilon}$ and $\boldsymbol{\mu}$.

$$
\begin{align}
\boldsymbol{\eta_{external}} &= \boldsymbol{\eta_{upml}} \\
\eta_0 \sqrt{\frac{\boldsymbol{\mu_{r,ext}}}{\boldsymbol{\varepsilon_{r,ext}}}} &= \eta_0 \sqrt{\frac{\boldsymbol{\mu_{r,pml}}}{\boldsymbol{\varepsilon_{r,pml}}}} \\
\frac{\boldsymbol{\mu_{r,ext}}}{\boldsymbol{\varepsilon_{r,ext}}} &= \frac{\boldsymbol{\mu_{r,pml}}}{\boldsymbol{\varepsilon_{r,pml}}} \\
\frac{\mu_{r,ext}}{\varepsilon_{r,ext}} &= \frac{\mu_{r,i} + \frac{\sigma^M_i}{j\omega\mu_0}}{\varepsilon_{r,i} + \frac{\sigma^E_i}{j\omega\varepsilon_0} } \\
\end{align}
$$

Where the external permeability and permittivity tensors are identity matrices for an isotropic material.
$$
\begin{align}
\boldsymbol{\varepsilon_{r,ext}} &=
\begin{bmatrix}
\varepsilon_{r,ext} & 0 & 0 \\
0 & \varepsilon_{r,ext} & 0 \\
0 & 0 & \varepsilon_{r,ext} \\
\end{bmatrix} \\
\boldsymbol{\mu_{r,ext}} &=
\begin{bmatrix}
\mu_{r,ext} & 0 & 0 \\
0 & \mu_{r,ext} & 0 \\
0 & 0 & \mu_{r,ext} \\
\end{bmatrix} \\
\end{align}
$$

If $\mu_{r,ext}$ and $\varepsilon_{r,ext}$ are real quantities then an impedance match can be achieved with the following ratio.

For the real component.

$$\frac{\mu_{r,ext}}{\varepsilon_{r,ext}} = \frac{\mu_{r,i}}{\varepsilon_{r,i}}$$

For the imaginary component.

$$
\begin{align}
\frac{\mu_{r,ext}}{\varepsilon_{r,ext}} &= \frac{\sigma_i^M \varepsilon_0}{\sigma_i^E \mu_0} \\
\frac{\mu_0\mu_{r,ext}}{\varepsilon_0\varepsilon_{r,ext}} &= \frac{\sigma_i^M}{\sigma_i^E} \\
(\eta_{external})^2 &= \frac{\sigma_i^M}{\sigma_i^E} \\
\end{align}
$$

For the PML to absorb energy and dissipate incoming electromagnetic waves both $\sigma_i^E$ and $\sigma_i^M$ should be positive and satisfy the above ratio.

### Simplifying PML by assuming it borders empty space
To simplify assume the PML is bordering a region with permittivity $\varepsilon_0$ and $\mu_0$ such that $\varepsilon_{r,ext} = \mu_{r,ext} = 1$. With this we get a new relationship for the complex permittivity and permeability of the PML derived from the impedance matching criteria.

$$
\begin{align}
\frac{\boldsymbol{\mu_{r,pml}}}{\boldsymbol{\varepsilon_{r,pml}}} &= \frac{\boldsymbol{\mu_{r,ext}}}{\boldsymbol{\varepsilon_{r,ext}}} \\
\frac{\boldsymbol{\mu_{r,pml}}}{\boldsymbol{\varepsilon_{r,pml}}} &= 1 \\
\boldsymbol{\varepsilon_{r,pml}} &= \boldsymbol{\mu_{r,pml}} \\
\varepsilon_{r,i} + \frac{\sigma^E_i}{j\omega\varepsilon_0} &= \mu_{r,i} + \frac{\sigma^M_i}{j\omega\mu_0} \\
\end{align}
$$

Therefore we can express the PML's complex permittivity and permeability tensor as

$$
\boldsymbol{\varepsilon_{r,pml}} = \boldsymbol{\mu_{r,pml}} = \begin{bmatrix}
a & 0 & 0 \\
0 & b & 0 \\
0 & 0 & c \\
\end{bmatrix}
$$

### Finding complex permittivity and permeability tensors that achieve no refraction and reflection 
Consider the refraction and reflection of a EM wave with a transverse electrical (TE) and transverse magnetic (TM) component entering from free space into the PML material.

First consider an oblique EM wave propagating along the z-axis where the PML's plane is x-y.
Refraction into the biaxial anisotropic material of a wave with angle $\theta_1$ refracting into the material with angle $\theta_2$ is defined by
$$
\sin(\theta_1) = \sqrt{bc} \sin(\theta_2)
$$

Reflection from a biaxial anisotropic material along transverse electric (TE) and transverse magnetic (TM) modes is given by
$$
\begin{align}
r_{TE} &= \frac{\sqrt{a}\cos{\theta_1} - \sqrt{b}\cos{\theta_2}}{\sqrt{a}\cos{\theta_1} + \sqrt{b}\cos{\theta_2}} \\
r_{TM} &= \frac{- \sqrt{a}\cos{\theta_1} + \sqrt{b}\cos{\theta_2}}{\sqrt{a}\cos{\theta_1} + \sqrt{b}\cos{\theta_2}} \\
\end{align}
$$


For a material with no refraction with $\theta_1 = \theta_2$ the relative permittivity and permeability coefficients must satisfy

$$
\begin{align}
\sqrt{bc} &= 1 \\
c &= \frac{1}{b} \\
\end{align}
$$

Since $\theta_1 = \theta_2$ then $\cos{\theta_1} = \cos{\theta_2}$ which when substituted into the reflection equations gives
$$
\begin{align}
r_{TE} &= \frac{\sqrt{a} - \sqrt{b}}{\sqrt{a} + \sqrt{b}} \\
r_{TM} &= \frac{- \sqrt{a} + \sqrt{b}}{\sqrt{a} + \sqrt{b}} \\
\end{align}
$$

For the material to also have no reflections then $r_{TE} = r_{TM} = 0$ giving
$$
\begin{align}
r_{TE} &= r_{TM} \\
\frac{\sqrt{a} - \sqrt{b}}{\sqrt{a} + \sqrt{b}} &= \frac{- \sqrt{a} + \sqrt{b}}{\sqrt{a} + \sqrt{b}} \\
\sqrt{a} &= \sqrt{b} \\
a &= b \\
\end{align}
$$

Hence for the material to have no reflection and refraction along the z-axis
$$
\boldsymbol{\varepsilon_{r,pml}} = \boldsymbol{\mu_{r,pml}} = \mathbf{S_z} = 
\begin{bmatrix}
S_z & 0 & 0 \\
0 & S_z & 0  \\
0 & 0 & \frac{1}{S_z} \\
\end{bmatrix}
$$

For all directions of propagation for an impedance matched PML that produces no reflections or refraction in that direction we get
$$
\begin{align}
\mathbf{S_x} &= 
\begin{bmatrix}
\frac{1}{S_x} & 0 & 0 \\
0 & S_x & 0  \\
0 & 0 & S_x \\
\end{bmatrix} \\
\mathbf{S_y} &= 
\begin{bmatrix}
S_y & 0 & 0 \\
0 & \frac{1}{S_y} & 0  \\
0 & 0 & S_y \\
\end{bmatrix} \\
\mathbf{S_z} &= 
\begin{bmatrix}
S_z & 0 & 0 \\
0 & S_z & 0  \\
0 & 0 & \frac{1}{S_z} \\
\end{bmatrix} \\
\end{align}
$$

For a perfectly matched layer that absorbs waves propagating in the x direction we use $\mathbf{S_x}$, y direction we use $\mathbf{S_y}$, and z direction we use $\mathbf{S_z}$.
Note that these relative permittivity and permeability coefficients are uniaxial anisotropic, which is why it is called a uniaxial perfectly matched layer or UPML.

The value for the diagonal values $S_i$ in the complex permittivity and permeability tensors for the PML $\mathbf{S_i}$ are

$$
S_i = \varepsilon_{r,i} + \frac{\sigma^E_i}{j\omega\varepsilon_0} = \mu_{r,i} + \frac{\sigma^M_i}{j\omega\mu_0}
$$

Where from our impedance matching criteria along with $\varepsilon_{r,ext} = \mu_{r,ext} = 1$ gives the following constraints for $S_i$

$$
\begin{align}
\frac{\mu_{r,i}}{\varepsilon_{r,i}} &= 1 \\
\frac{\sigma_i^M}{\sigma_i^E} &= \frac{\mu_0}{\varepsilon_0} \\
\end{align}
$$

## Deriving UPML update equations
### Maxwell's equations
Consider Maxwell's equations with no external forcing current density for the region bound by the UPML.

$$
\begin{align}
j \omega \boldsymbol{\varepsilon} \vec{E} &= \nabla \times \vec{H} \\
j \omega \boldsymbol{\mu} \vec{H} &= - \nabla \times \vec{E} \\
\end{align}
$$

Substituting the PML's complex permittivity and permeability tensor $\mathbf{S_i}$ gives

$$
\begin{align}
j \omega \varepsilon_0 \mathbf{S_i} \vec{E} &= \nabla \times \vec{H} \\
j \omega \mu_0 \mathbf{S_i} \vec{H} &= - \nabla \times \vec{E} \\
\end{align}
$$

### Deriving continuous time update equations for x-axis UPML
$$
\begin{align}
j \omega \varepsilon_0 \mathbf{S_x} \vec{E} &= \nabla \times \vec{H} \\
% 
j \omega \varepsilon_0 \begin{bmatrix}
\frac{1}{S_x} & 0 & 0 \\
0 & S_x & 0 \\
0 & 0 & S_x \\
\end{bmatrix}
\begin{bmatrix}
E_x \\
E_y \\
E_z \\
\end{bmatrix} &=
\begin{bmatrix}
0 & -\frac{\delta}{\delta z} & \frac{\delta}{\delta y} \\
\frac{\delta}{\delta z} & 0 & -\frac{\delta}{\delta x} \\
-\frac{\delta}{\delta y} & \frac{\delta}{\delta x} & 0 \\
\end{bmatrix}
\begin{bmatrix}
H_x \\
H_y \\
H_z \\
\end{bmatrix} \\
% 
j \omega \varepsilon_0 \begin{bmatrix}
\frac{1}{S_x} & 0 & 0 \\
0 & S_x & 0 \\
0 & 0 & S_x \\
\end{bmatrix}
\begin{bmatrix}
E_x \\
E_y \\
E_z \\
\end{bmatrix} &=
\begin{bmatrix}
\nabla_x^H \\
\nabla_y^H \\
\nabla_z^H \\
\end{bmatrix} \\
\end{align}
$$

Expanding this out we get the following equation for each component

$$
\begin{align}
j \omega \varepsilon_0 E_x &= S_x \nabla_x^H \\
j \omega \varepsilon_0 S_x E_y &= \nabla_y^H \\
j \omega \varepsilon_0 S_x E_z &= \nabla_z^H \\
\end{align}
$$

Substituting the complex permittivity $S_x = \varepsilon_{r,x} + \frac{\sigma_x^E}{j \omega \varepsilon_0}$ where $\varepsilon_x = \varepsilon_0 \varepsilon_{r,x}$ we get

$$
\begin{align}
j \omega \varepsilon_0 E_x &= \varepsilon_{r,x} \nabla_x^H + \frac{\sigma_x^E \nabla_x^H}{j \omega \varepsilon_0} \\
j \omega \varepsilon_x E_y + \sigma_x^E E_y &= \nabla_y^H \\
j \omega \varepsilon_x E_z + \sigma_x^E E_z &= \nabla_z^H \\
\end{align}
$$

Applying the Fourier transform we get the continuous update time domain equations

$$
\begin{align}
\varepsilon_0 \frac{d E_x(t)}{dt} &= \varepsilon_{r,x} \nabla_x^H(t) + \int_{-\infty}^{t}{\frac{\sigma_x^E}{\varepsilon_0} \nabla_x^H(\tau) d\tau} \\
\varepsilon_x \frac{d E_y(t)}{dt} + \sigma_x^E E_y(t) &= \nabla_y^H(t) \\
\varepsilon_x \frac{d E_z(t)}{dt} + \sigma_x^E E_z(t) &= \nabla_z^H(t) \\
\end{align}
$$

### Discretising x-axis UPML against Yee grid
For $E_y$ and $E_z$ they are the same as the regular FDTD equations in Equation 1.4 and Equation 1.5.

$$
\begin{align}
\varepsilon_x^{i,j+\frac{1}{2},k} \frac{E_{y,t}^{i,j+\frac{1}{2},k} - E_{y,t-1}^{i,j+\frac{1}{2},k}}{\Delta t} +
\sigma_x^{E,i,j+\frac{1}{2},k} E_{y,t}^{i,j+\frac{1}{2},k} &=
\frac{1}{\Delta x^i \Delta z^k} \left(
 H_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k-\frac{1}{2}} \Delta x^i
+ H_{z,t-\frac{1}{2}}^{i+\frac{1}{2},j+\frac{1}{2},k} \Delta z^k
- H_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k+\frac{1}{2}} \Delta x^i
- H_{z,t-\frac{1}{2}}^{i-\frac{1}{2},j+\frac{1}{2},k} \Delta z^k
\right) \\
\varepsilon_x^{i,j,k+\frac{1}{2}} \frac{E_{z,t}^{i,j,k+\frac{1}{2}} - E_{z,t-1}^{i,j,k+\frac{1}{2}}}{\Delta t} +
\sigma_x^{E,i,j,k+\frac{1}{2}} E_{z,t}^{i,j,k+\frac{1}{2}} &=
\frac{1}{\Delta x^i \Delta y^j} \left(
 H_{y,t-\frac{1}{2}}^{i-\frac{1}{2},j,k+\frac{1}{2}} \Delta y^j
+ H_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k+\frac{1}{2}} \Delta x^i
- H_{y,t-\frac{1}{2}}^{i+\frac{1}{2},j,k+\frac{1}{2}} \Delta y^j
- H_{x,t-\frac{1}{2}}^{i,j-\frac{1}{2},k+\frac{1}{2}} \Delta x^i
\right) \\
\end{align}
$$

For $E_x$ we get the following terms

$$
\begin{align}
\nabla_{x,t-\frac{1}{2}}^{H,i+\frac{1}{2},j,k} &=
\frac{1}{\Delta y^j \Delta z^k} \left(
H_{z,t-\frac{1}{2}}^{i+\frac{1}{2},j-\frac{1}{2},k} \Delta z^k
+ H_{y,t-\frac{1}{2}}^{i+\frac{1}{2},j,k+\frac{1}{2}} \Delta y^j
- H_{z,t-\frac{1}{2}}^{i+\frac{1}{2},j+\frac{1}{2},k} \Delta z^k
- H_{y,t-\frac{1}{2}}^{i+\frac{1}{2},j,k-\frac{1}{2}} \Delta y^j
\right) \\
\varepsilon_0 \frac{E_{x,t}^{i+\frac{1}{2},j,k} - E_{x,t-1}^{i+\frac{1}{2},j,k}}{\Delta t} &=
\varepsilon_{r,x}^{i+\frac{1}{2},j,k} \nabla_{x,t-\frac{1}{2}}^{H,i+\frac{1}{2},j,k} +
\frac{\sigma_x^{E,i+\frac{1}{2},j,k}}{\varepsilon_0} \sum_{\tau=\frac{1}{2}}^{t-\frac{1}{2}} \nabla_{x,\tau}^{H,i+\frac{1}{2},j,k} \Delta t \\
\end{align}
$$

### Converting to equivalent circuit form
To use this UPML in the equivalent circuit FDTD (EC-FDTD) we substitute 

$$
\begin{align}
V &= -E \Delta d \\
I &= H \Delta d \\
\end{align}
$$

For $V_y$ it is the same as the regular EC-FDTD in Equation 3.9.

$$
\begin{align}
- C_x^{i,j+\frac{1}{2},k} \frac{V_{y,t}^{i,j+\frac{1}{2},k} - V_{y,t-1}^{i,j+\frac{1}{2},k}}{\Delta t}
- \frac{1}{R_x^{E,i,j+\frac{1}{2},k}} V_{y,t}^{i,j+\frac{1}{2},k} &=
I_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k-\frac{1}{2}}
+ I_{z,t-\frac{1}{2}}^{i+\frac{1}{2},j+\frac{1}{2},k}
- I_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k+\frac{1}{2}}
- I_{z,t-\frac{1}{2}}^{i-\frac{1}{2},j+\frac{1}{2},k} \\
% 
\left(1 + \frac{\Delta t}{R_x^{E,i,j+\frac{1}{2},k} C_x^{i,j+\frac{1}{2},k}} \right) V_{y,t}^{i,j+\frac{1}{2},k}
&= V_{y,t-1}^{i,j+\frac{1}{2},k}
-\frac{\Delta t}{C_x^{i,j+\frac{1}{2},k}} \left(
I_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k-\frac{1}{2}}
+ I_{z,t-\frac{1}{2}}^{i+\frac{1}{2},j+\frac{1}{2},k}
- I_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k+\frac{1}{2}}
- I_{z,t-\frac{1}{2}}^{i-\frac{1}{2},j+\frac{1}{2},k}
\right) \\
\end{align}
$$

For $V_z$ it is the same as the regular EC-FDTD in Equation 3.10.
$$
\begin{align}
- C_x^{i,j,k+\frac{1}{2}} \frac{V_{z,t}^{i,j,k+\frac{1}{2}} - V_{z,t-1}^{i,j,k+\frac{1}{2}}}{\Delta t}
- \frac{1}{R_x^{E,i,j,k+\frac{1}{2}}} V_{z,t}^{i,j,k+\frac{1}{2}} &=
I_{y,t-\frac{1}{2}}^{i-\frac{1}{2},j,k+\frac{1}{2}}
+ I_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k+\frac{1}{2}}
- I_{y,t-\frac{1}{2}}^{i+\frac{1}{2},j,k+\frac{1}{2}}
- I_{x,t-\frac{1}{2}}^{i,j-\frac{1}{2},k+\frac{1}{2}} \\
% 
\left(1 + \frac{\Delta t}{R_x^{E,i,j,k+\frac{1}{2}} C_x^{i,j,k+\frac{1}{2}}} \right) V_{z,t}^{i,j,k+\frac{1}{2}}
&= V_{z,t-1}^{i,j,k+\frac{1}{2}}
- \frac{\Delta t}{C_x^{i,j,k+\frac{1}{2}}}
\left(
I_{y,t-\frac{1}{2}}^{i-\frac{1}{2},j,k+\frac{1}{2}}
+ I_{x,t-\frac{1}{2}}^{i,j+\frac{1}{2},k+\frac{1}{2}}
- I_{y,t-\frac{1}{2}}^{i+\frac{1}{2},j,k+\frac{1}{2}}
- I_{x,t-\frac{1}{2}}^{i,j-\frac{1}{2},k+\frac{1}{2}}
\right) \\
\end{align}
$$


For $V_x$ we get the following terms that are unique to the UPML along the axis of propagation.

$$
\nabla_{x,t-\frac{1}{2}}^{I,i+\frac{1}{2},j,k} =
I_{z,t-\frac{1}{2}}^{i+\frac{1}{2},j-\frac{1}{2},k}
+ I_{y,t-\frac{1}{2}}^{i+\frac{1}{2},j,k+\frac{1}{2}}
- I_{z,t-\frac{1}{2}}^{i+\frac{1}{2},j+\frac{1}{2},k}
- I_{y,t-\frac{1}{2}}^{i+\frac{1}{2},j,k-\frac{1}{2}}
$$

$$
% 
\begin{align}
-\frac{\varepsilon_0}{\Delta t \Delta x^{i+\frac{1}{2}}} \left( V_{x,t}^{i+\frac{1}{2},j,k} - V_{x,t-1}^{i+\frac{1}{2},j,k} \right) &=
\frac{\varepsilon_{r,x}^{i+\frac{1}{2},j,k}}{\Delta y^j \Delta z^k} \nabla_{x,t-\frac{1}{2}}^{I,i+\frac{1}{2},j,k} +
\frac{\sigma_x^{E,i+\frac{1}{2},j,k}}{\varepsilon_0 \Delta y^j \Delta z^k} \sum_{\tau=\frac{1}{2}}^{t-\frac{1}{2}} \nabla_{x,\tau}^{I,i+\frac{1}{2},j,k} \Delta t \\
% 
V_{x,t}^{i+\frac{1}{2},j,k} &= V_{x,t-1}^{i+\frac{1}{2},j,k}
- \frac{\Delta t \Delta x^{i+\frac{1}{2}}}{\varepsilon_0 \Delta y^j \Delta z^k}
\left(
\varepsilon_{r,x}^{i+\frac{1}{2},j,k} \nabla_{x,t-\frac{1}{2}}^{I,i+\frac{1}{2},j,k} +
\frac{\sigma_x^{E,i+\frac{1}{2},j,k} \Delta t}{\varepsilon_0} \sum_{\tau=\frac{1}{2}}^{t-\frac{1}{2}} \nabla_{x,\tau}^{I,i+\frac{1}{2},j,k}
\right )\\
\end{align}
$$

